/* The dashboard stays local; this client may use a separately deployed API. */
(function () {
  const TOKEN_KEY = "xhs-content-checker.session-token";
  let apiBase;
  const state = { user: null, tab: "audit", report: null, previews: [], admin: false, articles: [], articleEditor: null };
  const knowledge = [
    ["01", "发布节奏", "保持固定更新频率", "一周 1～3 篇都正常，尽量固定时间更新；避免一天内连续发布多篇内容。"],
    ["02", "发布时间", "注意发布时间", "可结合通勤、午休、晚饭和睡前等用户高频浏览时段安排发布。"],
    ["03", "社区互动", "保持真实互动", "发布之外也应正常浏览、点赞、评论与收藏，避免账号行为过于单一。"],
    ["07", "账号定位", "内容保持垂直", "减少跨赛道跳跃，帮助平台和受众建立稳定的内容预期。"],
    ["08", "封面", "封面和前五秒很重要", "让读者在短时间理解主题、价值和观看理由。"],
    ["09", "环境", "尽量保持稳定环境", "发布与浏览尽量使用稳定设备、网络与正常的账号行为。"]
  ];

  const escape = (value) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  const sanitizeMarkdownHtml = (html) => window.DOMPurify ? window.DOMPurify.sanitize(html) : escape(html);
  const renderMarkdown = (markdown) => window.EasyMDE
    ? window.EasyMDE.prototype.markdown.call({ options: { renderingConfig: { sanitizerFunction: sanitizeMarkdownHtml } } }, markdown)
    : escape(markdown).replace(/\n/g, "<br>");
  const status = (message = "", error = false) => {
    const target = document.getElementById("checkerStatus");
    if (target) { target.textContent = message; target.classList.toggle("error", error); }
  };
  const token = () => localStorage.getItem(TOKEN_KEY) || "";
  const resolveApiBase = async () => {
    if (apiBase) return apiBase;
    const response = await fetch("/api/content-checker-config");
    const config = await response.json().catch(() => ({}));
    if (!response.ok || !config.apiBase) {
      throw new Error(config.error || "发布前检测 API 配置不可用。");
    }
    apiBase = String(config.apiBase).replace(/\/$/, "");
    return apiBase;
  };
  const api = async (pathname, options = {}) => {
    const headers = new Headers(options.headers || {});
    if (token()) headers.set("Authorization", "Bearer " + token());
    const response = await fetch((await resolveApiBase()) + pathname, { ...options, headers, credentials: "include" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `服务返回 ${response.status}`);
    return payload;
  };
  const riskName = (risk) => ({ HIGH: "高风险", MEDIUM: "建议修改", LOW: "低风险", TIP: "措辞提示" }[risk] || "待复核");
  const date = (value) => value ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "-";

  async function refreshUser() {
    const payload = await api("/me");
    state.user = payload.user;
    state.admin = false;
    if (state.user) {
      try { await api("/admin/practice"); state.admin = true; } catch { state.admin = false; }
    }
  }

  function renderAuth() {
    const target = document.getElementById("checkerAuthSlot");
    if (!target) return;
    if (state.user) {
      target.innerHTML = `<span class="checker-account-email">${escape(state.user.email)}</span><button class="button" data-checker-action="show-membership">会员中心</button><button class="button" data-checker-action="logout">退出登录</button>`;
    } else {
      target.innerHTML = `<button class="button" data-checker-action="show-login">登录</button><button class="button primary" data-checker-action="show-register">注册</button>`;
    }
    document.querySelector('[data-checker-tab="admin"]')?.classList.toggle("hidden", !state.admin);
  }

  function resultHtml(report) {
    if (!report) return "";
    const issues = report.issues || [];
    return `<section class="checker-result" id="checkerResult">
      <div class="checker-score risk-${escape(report.overallRisk)}"><strong>${escape(report.score)}</strong><span>风险分</span></div>
      <div><span class="risk-badge risk-${escape(report.overallRisk)}">${riskName(report.overallRisk)}</span><h3>${escape(report.recommendation)}</h3><p>${escape(report.disclaimer || "检测仅供发布前风险参考。")}</p></div>
      <div class="checker-result-summary">高风险 ${report.summary?.high || 0} · 建议修改 ${report.summary?.medium || 0} · 低风险 ${report.summary?.low || 0}</div>
      <div class="checker-issue-list">${issues.length ? issues.map((issue) => `<article class="checker-issue"><span class="risk-badge risk-${escape(issue.severity)}">${riskName(issue.severity)}</span><div><b>${escape(issue.category)}</b><p>证据：${escape(issue.evidence)}</p><p>${escape(issue.reason)}</p><p class="checker-suggestion">建议：${escape(issue.suggestion)}</p></div></article>`).join("") : "<p class=\"checker-empty\">未发现需修改的风险线索。</p>"}</div>
      ${renderImageEvidence(issues)}
    </section>`;
  }

  function renderImageEvidence(issues) {
    const imageIssues = issues.filter((issue) => issue.source === "image" && issue.bbox && state.previews[issue.imageIndex - 1]);
    if (!imageIssues.length) return "";
    const cards = state.previews.map((preview, index) => {
      const findings = imageIssues.filter((issue) => issue.imageIndex === index + 1);
      if (!findings.length) return "";
      return `<figure class="checker-evidence-image"><div><img src="${escape(preview.src)}" alt="${escape(preview.name)}" />${findings.map((issue) => `<i title="${escape(issue.category)}" style="left:${issue.bbox.x / 10}%;top:${issue.bbox.y / 10}%;width:${issue.bbox.width / 10}%;height:${issue.bbox.height / 10}%"></i>`).join("")}</div><figcaption>图片 ${index + 1}：${findings.map((issue) => escape(issue.category)).join("、")}</figcaption></figure>`;
    }).join("");
    return cards ? `<section class="checker-evidence"><h3>图片风险位置</h3><div>${cards}</div></section>` : "";
  }

  function auditView() {
    return `
      <form id="checkerAuditForm" class="checker-form">
        <div class="checker-form-head"><h3>开始检测笔记</h3><label>平台 <select name="platform"><option value="XIAOHONGSHU">小红书</option><option value="DOUYIN">抖音</option></select></label></div>
        <div class="checker-form-grid"><div><label>标题 <small>最多 120 字</small><input name="title" maxlength="120" placeholder="输入笔记标题" /></label><label>图片 <small>最多 18 张，每张 10MB</small><input id="checkerImages" name="images" type="file" accept="image/jpeg,image/png,image/webp" multiple /></label><div id="checkerPreviews" class="checker-previews"></div></div><div><label>正文 <small>最多 5,000 字</small><textarea name="body" maxlength="5000" placeholder="粘贴或输入笔记正文。"></textarea></label><p class="checker-disclaimer">检测结果是发布前风险提示，不代表小红书、抖音或其他平台的官方审核结论。</p><button class="button primary" type="submit">开始 AI 检测</button></div></div>
      </form>${resultHtml(state.report)}`;
  }

  async function historyView() {
    if (!state.user) return loginRequired("登录后查看并跨设备保存完整检测记录。");
    const { audits } = await api("/audits");
    return `<section class="checker-page-head"><div><span class="panel-kicker">MY AUDITS</span><h3>历史检测记录</h3></div><button class="button primary" data-checker-action="select-tab" data-tab="audit">新建检测</button></section><div class="checker-history">${audits.length ? audits.map((audit) => `<details><summary><b>${escape(audit.title || "未命名检测")}</b><span>${escape(audit.platform === "DOUYIN" ? "抖音" : "小红书")}</span><span class="risk-badge risk-${escape(audit.overallRisk)}">${riskName(audit.overallRisk)} ${audit.score}</span><time>${date(audit.createdAt)}</time></summary><div class="checker-history-detail"><p><b>正文：</b>${escape(audit.body || "未填写")}</p>${(audit.issues || []).map((issue) => `<article><span class="risk-badge risk-${escape(issue.severity)}">${riskName(issue.severity)}</span><b>${escape(issue.category)}</b><p>证据：${escape(issue.evidence)}</p><p>建议：${escape(issue.suggestion)}</p></article>`).join("")}</div></details>`).join("") : "<p class=\"checker-empty\">还没有云端检测记录。</p>"}</div>`;
  }

  function knowledgeView() {
    return `<section class="checker-page-head"><div><span class="panel-kicker">KNOWLEDGE BASE</span><h3>正向实践知识库</h3><p>将检测与发布后的数据复盘结合，持续优化创作习惯。</p></div></section><div class="checker-knowledge">${knowledge.map(([number, category, title, body]) => `<article><span>${number} · ${escape(category)}</span><h3>${escape(title)}</h3><p>${escape(body)}</p><b>建议这样做</b><p>以真实、稳定、可验证的内容和账号行为建立长期信任。</p></article>`).join("")}</div>`;
  }

  async function practiceView() {
    if (!state.user) return loginRequired("登录后访问实操库文章。");
    const { articles } = await api("/practice"); state.articles = articles;
    return `<section class="checker-page-head"><div><span class="panel-kicker">PRACTICE LIBRARY</span><h3>实操库</h3><p>可直接应用的内容技巧，打开即可照着做。</p></div><form id="checkerPracticeSearch"><input name="q" placeholder="按标题搜索" /><button class="button" type="submit">搜索</button></form></section><div class="checker-articles">${articles.length ? articles.map((article) => `<button data-checker-action="article" data-id="${escape(article.id)}"><span>发布时间 ${date(article.publishedAt)}</span><h3>${escape(article.title)}</h3></button>`).join("") : "<p class=\"checker-empty\">暂无实操文章。</p>"}</div><article id="checkerArticleDetail" class="checker-article-detail hidden"></article>`;
  }

  function membershipView() {
    if (!state.user) return loginRequired("登录后查看你的套餐与审核额度。");
    const plans = [["FREE", "免费版", "¥0", "3 次完整审核 / 月", "标题与正文规则检测 · 最近 7 天记录"], ["PRO", "专业版", "¥39", "100 次完整审核 / 月", "1–18 张图片多模态审核 · 完整历史记录"], ["TEAM", "团队版", "¥199", "800 次完整审核 / 月", "5 个成员席位 · 优先模型队列与 API"]];
    return `<section class="checker-page-head"><div><span class="panel-kicker">MEMBERSHIP</span><h3>会员中心</h3><p>当前方案：${escape(state.user.plan)} · ${escape(state.user.status)} · 每月 ${escape(state.user.monthlyQuota)} 次完整审核。</p></div></section><div class="checker-plans">${plans.map(([id, name, price, quota, features]) => `<article class="${state.user.plan === id ? "active" : ""}"><h3>${name}</h3><strong>${price}<small> / 月</small></strong><p>${quota}</p><p>${features}</p><button class="button ${state.user.plan === id ? "" : "primary"}" disabled>${state.user.plan === id ? "当前方案" : "支付接入后启用"}</button></article>`).join("")}</div>`;
  }

  async function adminView() {
    const { articles } = await api("/admin/practice");
    return `<section class="checker-page-head"><div><span class="panel-kicker">ADMIN</span><h3>管理实操库</h3><p>创建、编辑并发布实操文章。</p></div></section><div class="checker-admin-grid"><form id="checkerArticleForm" class="checker-form"><input type="hidden" name="id" /><label>标题<input name="title" maxlength="160" required /></label><label>状态<select name="status"><option value="DRAFT">草稿</option><option value="PUBLISHED">发布</option><option value="OFFLINE">下线</option></select></label><div class="checker-markdown-field"><div class="checker-markdown-label"><label for="checkerArticleBody">正文</label><small>支持 Markdown，右侧可实时预览</small></div><textarea id="checkerArticleBody" name="body" required placeholder="开始撰写文章…"></textarea></div><div class="checker-form-actions"><button class="button primary" type="submit">保存文章</button><button class="button" type="button" data-checker-action="new-article">新建</button></div></form><div class="checker-admin-list">${articles.map((article) => `<button data-checker-action="edit-article" data-article="${escape(encodeURIComponent(JSON.stringify(article)))}"><span>${escape(article.status)} · ${date(article.updatedAt)}</span><b>${escape(article.title)}</b></button>`).join("") || "暂无文章"}</div></div>`;
  }

  function loginRequired(message) { return `<section class="checker-login-required"><h3>${escape(message)}</h3><button class="button primary" data-checker-action="show-login">登录</button><button class="button" data-checker-action="show-register">注册</button></section>`; }
  function loginView() { return `<form id="checkerAuthForm" class="checker-auth-form" data-auth-mode="login"><span class="panel-kicker">ACCOUNT</span><h3>登录</h3><label>邮箱 <input name="email" type="email" autocomplete="email" required /></label><label>密码 <input name="password" type="password" autocomplete="current-password" minlength="8" required /></label><div><button class="button primary" type="submit">登录</button><button class="button" type="button" data-checker-action="show-register">去注册</button><button class="button" type="button" data-checker-action="back">返回</button></div></form>`; }
  function registerView() { return `<form id="checkerAuthForm" class="checker-auth-form" data-auth-mode="register"><span class="panel-kicker">ACCOUNT</span><h3>注册</h3><label>邮箱 <input name="email" type="email" autocomplete="email" required /></label><label>密码 <input name="password" type="password" autocomplete="new-password" minlength="8" required /></label><div><button class="button primary" type="submit">注册</button><button class="button" type="button" data-checker-action="show-login">去登录</button><button class="button" type="button" data-checker-action="back">返回</button></div></form>`; }

  async function render() {
    renderAuth();
    const content = document.getElementById("checkerContent"); if (!content) return;
    window.dispatchEvent(new CustomEvent("content-checker-tabchange", { detail: { tab: state.tab } }));
    try {
      let html;
      if (state.tab === "login") html = loginView(); else if (state.tab === "register") html = registerView(); else if (state.tab === "audit") html = auditView(); else if (state.tab === "history") html = await historyView(); else if (state.tab === "knowledge") html = knowledgeView(); else if (state.tab === "practice") html = await practiceView(); else if (state.tab === "membership") html = membershipView(); else html = await adminView();
      state.articleEditor?.toTextArea();
      state.articleEditor = null;
      content.innerHTML = html;
      bindFormEvents();
    } catch (error) { content.innerHTML = `<p class="checker-empty">读取失败：${escape(error.message)}</p>`; status(error.message, true); }
  }

  function bindFormEvents() {
    document.getElementById("checkerImages")?.addEventListener("change", (event) => { state.previews.forEach((image) => URL.revokeObjectURL(image.src)); state.previews = [...event.target.files].slice(0, 18).map((file) => ({ name: file.name, src: URL.createObjectURL(file) })); const target = document.getElementById("checkerPreviews"); if (target) target.innerHTML = state.previews.map((image) => `<img src="${escape(image.src)}" alt="${escape(image.name)}" />`).join(""); });
    document.getElementById("checkerAuditForm")?.addEventListener("submit", submitAudit);
    document.getElementById("checkerAuthForm")?.addEventListener("submit", submitAuth);
    document.getElementById("checkerPracticeSearch")?.addEventListener("submit", searchPractice);
    document.getElementById("checkerArticleForm")?.addEventListener("submit", saveArticle);
    const articleBody = document.getElementById("checkerArticleBody");
    if (articleBody && window.EasyMDE) { state.articleEditor = new window.EasyMDE({ element: articleBody, minHeight: "500px", sideBySideFullscreen: false, spellChecker: false, nativeSpellcheck: true, renderingConfig: { sanitizerFunction: sanitizeMarkdownHtml }, toolbar: ["heading", "bold", "italic", "strikethrough", "|", "quote", "unordered-list", "ordered-list", "task", "|", "link", "image", "table", "code", "|", "preview", "side-by-side", "fullscreen", "guide"] }); state.articleEditor.toggleSideBySide(); }
  }

  async function submitAudit(event) { event.preventDefault(); const form = new FormData(event.currentTarget); status("正在综合审核…"); try { state.report = await api("/audits", { method: "POST", body: form }); await render(); status(state.report.historyScope === "account" ? "检测完成，已保存到你的账户。" : "检测完成；登录后可保存到云端记录。"); document.getElementById("checkerResult")?.scrollIntoView({ behavior: "smooth", block: "start" }); } catch (error) { status(error.message, true); } }
  async function submitAuth(event) { event.preventDefault(); const mode = event.currentTarget.dataset.authMode || "login"; const form = Object.fromEntries(new FormData(event.currentTarget)); status(mode === "login" ? "正在登录…" : "正在注册…"); try { const response = await api(`/auth/${mode}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) }); localStorage.setItem(TOKEN_KEY, response.token); await refreshUser(); state.tab = "audit"; await render(); status("账户已连接。"); } catch (error) { status(error.message, true); } }
  async function searchPractice(event) { event.preventDefault(); try { const q = new FormData(event.currentTarget).get("q"); const { articles } = await api(`/practice?q=${encodeURIComponent(q || "")}`); state.articles = articles; const list = document.querySelector(".checker-articles"); if (list) list.innerHTML = articles.map((article) => `<button data-checker-action="article" data-id="${escape(article.id)}"><span>发布时间 ${date(article.publishedAt)}</span><h3>${escape(article.title)}</h3></button>`).join("") || "<p class=\"checker-empty\">暂无匹配文章。</p>"; } catch (error) { status(error.message, true); } }
  async function saveArticle(event) { event.preventDefault(); const form = Object.fromEntries(new FormData(event.currentTarget)); form.body = state.articleEditor?.value() || ""; const id = form.id; delete form.id; try { await api(id ? `/admin/practice/${id}` : "/admin/practice", { method: id ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) }); status("文章已保存。"); await render(); } catch (error) { status(error.message, true); } }

  document.addEventListener("click", async (event) => {
    const action = event.target.closest("[data-checker-action]"); if (!action) return;
    const type = action.dataset.checkerAction;
    if (type === "select-tab") { state.tab = action.dataset.tab || "audit"; await render(); return; }
    if (type === "show-login") { state.tab = "login"; await render(); }
    if (type === "show-register") { state.tab = "register"; await render(); }
    if (type === "show-membership") { state.tab = "membership"; await render(); }
    if (type === "back") { state.tab = "audit"; await render(); }
    if (type === "logout") { try { await api("/auth/logout", { method: "POST" }); } finally { localStorage.removeItem(TOKEN_KEY); state.user = null; state.admin = false; state.tab = "audit"; await render(); status("已退出登录。"); } }
    if (type === "article") { try { const { article } = await api(`/practice/${action.dataset.id}`); const detail = document.getElementById("checkerArticleDetail"); if (detail) { detail.classList.remove("hidden"); detail.innerHTML = `<h2>${escape(article.title)}</h2><div class="editor-preview practice-markdown">${renderMarkdown(article.body)}</div>`; detail.scrollIntoView({ behavior: "smooth" }); } } catch (error) { status(error.message, true); } }
    if (type === "new-article") { const form = document.getElementById("checkerArticleForm"); form?.reset(); state.articleEditor?.value(""); }
    if (type === "edit-article") { const article = JSON.parse(decodeURIComponent(action.dataset.article)); const form = document.getElementById("checkerArticleForm"); form.elements.id.value = article.id; form.elements.title.value = article.title; form.elements.status.value = article.status; state.articleEditor?.value(article.body); window.scrollTo({ top: form.getBoundingClientRect().top + window.scrollY - 80, behavior: "smooth" }); }
  });

  window.ContentChecker = {
    async init() { try { await refreshUser(); } catch (error) { status(`审核功能暂不可用：${error.message}`, true); } finally { renderAuth(); } },
    async show(tab) { if (tab) state.tab = tab; await this.init(); await render(); },
    async selectTab(tab) { state.tab = tab || "audit"; await render(); }
  };
})();
