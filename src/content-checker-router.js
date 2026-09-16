const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const express = require("express");
const multer = require("multer");
const mysql = require("mysql2/promise");
const { hashPassword, verifyPassword, newSessionToken, hashToken, sessionExpiry } = require("./content-checker-auth");
const { audit } = require("./content-checker-moderation");

function createContentCheckerRouter({ projectRoot }) {
  const router = express.Router();
  const uploadDir = path.resolve(process.env.UPLOAD_DIR || path.join(projectRoot, "data", "content-checker-uploads"));
  const adminEmails = new Set(String(process.env.ADMIN_EMAILS || "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean));
  const upload = multer({ storage: multer.memoryStorage(), limits: { files: 18, fileSize: 10 * 1024 * 1024 } });
  let pool;

  function database() {
    if (!process.env.DATABASE_URL) throw new Error("审核账户功能尚未配置 DATABASE_URL。");
    if (!pool) pool = mysql.createPool({ uri: process.env.DATABASE_URL, waitForConnections: true, connectionLimit: 10, queueLimit: 0, timezone: "Z" });
    return pool;
  }

  async function rows(sql, values = []) {
    const [result] = await database().execute(sql, values);
    return result;
  }

  function cookieToken(req) {
    const bearer = String(req.headers.authorization || "").match(/^Bearer\s+(.+)$/i)?.[1];
    if (bearer) return bearer;
    return String(req.headers.cookie || "").match(/(?:^|;\s*)note_guard_session=([^;]+)/)?.[1];
  }

  async function currentUser(req) {
    const token = cookieToken(req);
    if (!token) return null;
    const result = await rows("SELECT users.id, users.email, users.display_name AS displayName, users.created_at AS createdAt, memberships.plan, memberships.status, memberships.monthly_quota AS monthlyQuota, memberships.period_ends_at AS periodEndsAt FROM sessions INNER JOIN users ON users.id = sessions.user_id INNER JOIN memberships ON memberships.user_id = users.id WHERE sessions.token_hash = ? AND sessions.expires_at > UTC_TIMESTAMP()", [hashToken(token)]);
    return result[0] || null;
  }

  function publicUser(user) {
    if (!user) return null;
    return { id: user.id, email: user.email, displayName: user.displayName || "", createdAt: user.createdAt, plan: user.plan, status: user.status, monthlyQuota: Number(user.monthlyQuota), periodEndsAt: user.periodEndsAt };
  }

  function requireUser(handler) {
    return async (req, res, next) => {
      try {
        const user = await currentUser(req);
        if (!user) return res.status(401).json({ error: "请先登录。" });
        req.user = user;
        return handler(req, res, next);
      } catch (error) { return next(error); }
    };
  }

  function requireAdmin(handler) {
    return requireUser((req, res, next) => {
      if (!adminEmails.has(String(req.user.email).toLowerCase())) return res.status(403).json({ error: "仅管理员可执行此操作。" });
      return handler(req, res, next);
    });
  }

  function sessionResponse(req, res, token, expiresAt) {
    const secure = req.secure || String(req.headers["x-forwarded-proto"] || "").split(",")[0] === "https";
    res.cookie("note_guard_session", token, { httpOnly: true, sameSite: "lax", secure, expires: expiresAt, path: "/" });
    return res.json({ ok: true, token, expiresAt: expiresAt.toISOString() });
  }

  async function createSession(req, res, userId) {
    const token = newSessionToken();
    const expiresAt = sessionExpiry();
    await database().execute("DELETE FROM sessions WHERE expires_at <= UTC_TIMESTAMP()");
    await database().execute("INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES (?,?,?,?)", [crypto.randomUUID(), userId, hashToken(token), expiresAt]);
    return sessionResponse(req, res, token, expiresAt);
  }

  async function assertQuota(userId) {
    const membership = (await rows("SELECT monthly_quota, status FROM memberships WHERE user_id = ?", [userId]))[0];
    if (!membership || membership.status !== "ACTIVE") throw new Error("当前会员状态不可用，请在会员中心处理后重试。");
    const usage = (await rows("SELECT COUNT(*) AS used FROM usage_events WHERE user_id = ? AND created_at >= DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-01')", [userId]))[0];
    if (Number(usage?.used || 0) >= Number(membership.monthly_quota)) throw new Error("本月完整审核额度已用完，请升级会员或下月再试。");
  }

  async function storeAssets(files, reportId) {
    if (!files?.length) return [];
    fs.mkdirSync(uploadDir, { recursive: true, mode: 0o700 });
    const entries = [];
    for (const file of files) {
      const extension = path.extname(file.originalname || "") || ".bin";
      const key = `${reportId}/${crypto.randomUUID()}${extension}`;
      const target = path.join(uploadDir, key);
      fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
      fs.writeFileSync(target, file.buffer, { mode: 0o600 });
      entries.push({ id: crypto.randomUUID(), key, originalName: file.originalname, mimeType: file.mimetype, bytes: file.size, sha256: crypto.createHash("sha256").update(file.buffer).digest("hex"), target });
    }
    return entries;
  }

  async function saveAudit(userId, report, input, files) {
    const client = await database().getConnection();
    let assets = [];
    try {
      assets = await storeAssets(files, report.id);
      await client.beginTransaction();
      await client.execute("INSERT INTO audit_reports (id, user_id, platform, title, body, score, overall_risk, recommendation, engine) VALUES (?,?,?,?,?,?,?,?,?)", [report.id, userId, report.platform, input.title || null, input.body || null, report.score, report.overallRisk, report.recommendation, JSON.stringify(report.engine)]);
      for (const issue of report.issues) await client.execute("INSERT INTO audit_issues (id, report_id, source, image_index, category, severity, evidence, reason, suggestion, bbox, rule_path) VALUES (?,?,?,?,?,?,?,?,?,?,?)", [crypto.randomUUID(), report.id, issue.source, issue.imageIndex || null, issue.category, issue.severity, issue.evidence, issue.reason, issue.suggestion, issue.bbox ? JSON.stringify(issue.bbox) : null, issue.rulePath ? JSON.stringify(issue.rulePath) : null]);
      for (const asset of assets) await client.execute("INSERT INTO assets (id, report_id, storage_key, original_name, mime_type, byte_size, sha256) VALUES (?,?,?,?,?,?,?)", [asset.id, report.id, asset.key, asset.originalName, asset.mimeType, asset.bytes, asset.sha256]);
      await client.execute("INSERT INTO usage_events (id, user_id, report_id) VALUES (?,?,?)", [crypto.randomUUID(), userId, report.id]);
      await client.commit();
    } catch (error) {
      await client.rollback();
      assets.forEach((asset) => fs.rmSync(asset.target, { force: true }));
      throw error;
    } finally { client.release(); }
  }

  async function auditHistory(userId) {
    const reports = await rows("SELECT id, title, body, platform, score, overall_risk AS overallRisk, recommendation, created_at AS createdAt FROM audit_reports WHERE user_id = ? ORDER BY created_at DESC LIMIT 100", [userId]);
    if (!reports.length) return [];
    const ids = reports.map((item) => item.id);
    const issues = await rows(`SELECT id, report_id AS reportId, source, image_index AS imageIndex, category, severity, evidence, reason, suggestion FROM audit_issues WHERE report_id IN (${ids.map(() => "?").join(",")}) ORDER BY report_id, id`, ids);
    const byReport = new Map();
    issues.forEach((issue) => byReport.set(issue.reportId, [...(byReport.get(issue.reportId) || []), issue]));
    return reports.map((report) => ({ ...report, issues: byReport.get(report.id) || [] }));
  }

  function articleInput(body) {
    const title = String(body?.title || "").trim().slice(0, 160);
    const content = String(body?.body || "").trim();
    const status = ["DRAFT", "PUBLISHED", "OFFLINE"].includes(body?.status) ? body.status : "DRAFT";
    if (!title || !content) throw new Error("标题和正文不能为空。");
    return { title, body: content, status, publishedAt: status === "PUBLISHED" ? (body?.publishedAt ? new Date(body.publishedAt) : new Date()) : null };
  }

  router.get("/health", (req, res) => res.json({ ok: true, service: "dashboard-content-checker", modelConfigured: Boolean(process.env.DASHSCOPE_API_KEY) }));
  router.post("/auth/register", async (req, res, next) => { try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    if (!/^\S+@\S+\.\S+$/.test(email) || password.length < 8) return res.status(400).json({ error: "请输入有效邮箱，密码至少 8 位。" });
    if ((await rows("SELECT id FROM users WHERE email = ?", [email])).length) return res.status(409).json({ error: "该邮箱已经注册。" });
    const client = await database().getConnection();
    try { await client.beginTransaction(); const userId = crypto.randomUUID(); await client.execute("INSERT INTO users (id, email, display_name, password_hash) VALUES (?,?,?,?)", [userId, email, String(req.body?.displayName || "").trim().slice(0, 40) || null, await hashPassword(password)]); await client.execute("INSERT INTO memberships (id, user_id, plan, status, monthly_quota) VALUES (?,?,'FREE','ACTIVE',3)", [crypto.randomUUID(), userId]); await client.commit(); await createSession(req, res, userId); } catch (error) { await client.rollback(); throw error; } finally { client.release(); }
  } catch (error) { next(error); } });
  router.post("/auth/login", async (req, res, next) => { try {
    const email = String(req.body?.email || "").trim().toLowerCase(); const password = String(req.body?.password || "");
    const user = (await rows("SELECT id, password_hash FROM users WHERE email = ?", [email]))[0];
    if (!user || !(await verifyPassword(password, user.password_hash))) return res.status(401).json({ error: "邮箱或密码不正确。" });
    await createSession(req, res, user.id);
  } catch (error) { next(error); } });
  router.post("/auth/logout", async (req, res, next) => { try { const token = cookieToken(req); if (token) await database().execute("DELETE FROM sessions WHERE token_hash = ?", [hashToken(token)]); res.clearCookie("note_guard_session", { path: "/" }); res.json({ ok: true }); } catch (error) { next(error); } });
  router.get("/me", async (req, res, next) => { try { res.json({ user: publicUser(await currentUser(req)) }); } catch (error) { next(error); } });

  router.post("/audits", upload.array("images", 18), async (req, res, next) => { try {
    const title = String(req.body?.title || "").trim().slice(0, 120); const body = String(req.body?.body || "").trim().slice(0, 5000); const platform = req.body?.platform === "DOUYIN" ? "DOUYIN" : "XIAOHONGSHU"; const files = req.files || [];
    if (!title && !body && !files.length) return res.status(400).json({ error: "请至少提供标题、正文或一张图片。" });
    if (files.some((file) => !["image/jpeg", "image/png", "image/webp"].includes(file.mimetype))) return res.status(400).json({ error: "仅支持 JPG、PNG、WEBP 图片。" });
    const user = await currentUser(req); if (user) await assertQuota(user.id);
    const report = await audit({ title, body, platform, images: files.map((file) => ({ name: file.originalname, mimeType: file.mimetype, dataUrl: `data:${file.mimetype};base64,${file.buffer.toString("base64")}` })) });
    if (user) await saveAudit(user.id, report, { title, body }, files);
    res.json({ ...report, historyScope: user ? "account" : "local" });
  } catch (error) { next(error); } });
  router.get("/audits", requireUser(async (req, res, next) => { try { res.json({ audits: await auditHistory(req.user.id) }); } catch (error) { next(error); } }));

  router.get("/practice", requireUser(async (req, res, next) => { try { const query = String(req.query.q || "").trim().slice(0, 100); const values = query ? [query] : []; const articles = await rows(`SELECT id, title, body, status, published_at AS publishedAt, created_at AS createdAt, updated_at AS updatedAt FROM practice_articles WHERE status = 'PUBLISHED' ${query ? "AND title LIKE CONCAT('%', ?, '%')" : ""} ORDER BY published_at DESC`, values); res.json({ articles }); } catch (error) { next(error); } }));
  router.get("/practice/:id", requireUser(async (req, res, next) => { try { const article = (await rows("SELECT id, title, body, status, published_at AS publishedAt, created_at AS createdAt, updated_at AS updatedAt FROM practice_articles WHERE id = ? AND status = 'PUBLISHED'", [req.params.id]))[0]; if (!article) return res.status(404).json({ error: "未找到文章。" }); res.json({ article }); } catch (error) { next(error); } }));
  router.get("/admin/practice", requireAdmin(async (req, res, next) => { try { res.json({ articles: await rows("SELECT id, title, body, status, published_at AS publishedAt, created_at AS createdAt, updated_at AS updatedAt FROM practice_articles ORDER BY updated_at DESC") }); } catch (error) { next(error); } }));
  router.post("/admin/practice", requireAdmin(async (req, res, next) => { try { const input = articleInput(req.body); const id = crypto.randomUUID(); await database().execute("INSERT INTO practice_articles (id, title, body, status, published_at) VALUES (?,?,?,?,?)", [id, input.title, input.body, input.status, input.publishedAt]); res.status(201).json({ article: { id, ...input } }); } catch (error) { next(error); } }));
  router.put("/admin/practice/:id", requireAdmin(async (req, res, next) => { try { const input = articleInput(req.body); const result = await database().execute("UPDATE practice_articles SET title=?, body=?, status=?, published_at=? WHERE id=?", [input.title, input.body, input.status, input.publishedAt, req.params.id]); if (!result[0].affectedRows) return res.status(404).json({ error: "未找到文章。" }); res.json({ article: { id: req.params.id, ...input } }); } catch (error) { next(error); } }));
  router.get("/membership", requireUser(async (req, res) => res.json({ membership: publicUser(req.user) })));

  router.use((error, req, res, next) => { void req; void next; if (error instanceof multer.MulterError) return res.status(400).json({ error: error.code === "LIMIT_FILE_SIZE" ? "单张图片不能超过 10MB。" : "图片上传不符合要求。" }); console.error(error); return res.status(500).json({ error: error instanceof Error ? error.message : "服务暂时不可用。" }); });
  return router;
}

module.exports = { createContentCheckerRouter };
