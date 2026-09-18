/* The dashboard stays local; this client may use a separately deployed API. */
(function () {
  const TOKEN_KEY = "xhs-content-checker.session-token";
  let apiBase;
  const state = { user: null, tab: "audit", report: null, previews: [], auditFiles: [], auditDraft: null, admin: false, articles: [], articleEditor: null, article: null, knowledgeSourceCopy: "" };
  const knowledge = [
    { number: "01", category: "发布节奏", title: "保持固定更新频率", summary: "一周内，1～3篇都是正常频率，但尽量固定时间更新。一天内连续多次发布，容易被判定为营销号", actions: ["❌一天发布多篇内容", "✅每隔1～2天固定频率更新"] },
    { number: "02", category: "发布时间", title: "注意发布时间", summary: "工作日可考虑通勤、午休、晚饭、睡前等刷手机的高频时段。周末两天正常在非睡眠时间发布即可", actions: ["✅8:00～9:00", "✅11:30～12:30", "✅17:00～19:00", "✅21:00～23：00"] },
    { number: "03", category: "社区互动", title: "注意养号，记得浏览、点赞、评论、收藏", summary: "养号是为了让平台识别到，这个账号是真人实际使用。如果你只发布而不浏览平台本身的内容，也很容易被识别为营销号。", actions: ["✅可以每天浏览15～30分钟", "✅多多与其他博主互动：点赞、评论、收藏 "] },
    { number: "07", category: "账号定位", title: "内容垂直，不要一天换一个赛道发", summary: "你今天发美食，明天发宠物，后天发游戏。站在平台的角度，这些内容过于分散，根本没办法做到精准推送。", context: "如果你每个赛道都发作品，那你实际上是在和每一个赛道的垂直博主竞争。这里有一个问题，为什么别人不看专业的垂类博主，要来看每一样都只懂一些皮毛的人呢？", actions: ["✅发其他赛道的内容，使用其他手机号注册新的号，确保内容垂直"] },
    { number: "08", category: "封面", title: "封面和视频前五秒，很重要", summary: "站在读者/观众视角，如果他不能在短时间内快速了解你的内容主题，很容易就滑到下一个视频", actions: ["❌标题：做自媒体这段时间，我总结了一些自己的经验", "✅标题：做自媒体3个月，我最后悔的是一直追热点", "封面参考"] },
    { number: "09", category: "环境", title: "尽量保证一机一号一网络", summary: "平台会检测IP，如果你经常开代理，记得在发布/浏览时，切回国内的固定网络环境。", context: "平台还会检测设备，如果在该设备上已被拉黑过账号，大概率会影响到该设备上的其他正常账号", actions: ["❌开代理浏览小红书/抖音，发布作品", "✅不要经常换设备、网络"] }
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
    const draft = state.auditDraft || {};
    const importedMessage = draft.importedMessage ? `<p class="checker-audit-imported">${escape(draft.importedMessage)}</p>` : "";
    return `
      <form id="checkerAuditForm" class="checker-form checker-audit-form">
        <div class="checker-audit-form-head"><div><h3>开始检测笔记</h3><p>填写标题、正文和图片，快速获得发布前的内容风险建议。</p>${importedMessage}</div><label class="checker-platform-field"><span>发布平台</span><select class="checker-platform-select" name="platform"><option value="XIAOHONGSHU">小红书</option><option value="DOUYIN">抖音</option></select></label></div>
        <div class="checker-audit-grid"><section class="checker-audit-column"><label class="checker-field-label" for="checkerTitle"><span>标题</span><small>最多 120 字</small></label><input id="checkerTitle" name="title" maxlength="120" placeholder="输入笔记标题" value="${escape(draft.title || "")}" /><div class="checker-upload-field"><div class="checker-field-label"><span>图片素材</span><small>最多 18 张，每张不超过 10MB</small></div><input id="checkerImages" class="checker-file-input" name="images" type="file" accept="image/jpeg,image/png,image/webp" multiple /><label class="checker-upload-dropzone" for="checkerImages"><span class="checker-upload-icon" aria-hidden="true"><img class="icon-image icon-upload-computer-image" src="./icons/upload-computer.svg" alt="" /></span><strong data-upload-title>点击选择或拖拽图片至此</strong><span data-upload-hint>支持 JPG、PNG、WebP 格式</span></label><div id="checkerPreviews" class="checker-previews"></div></div></section><section class="checker-audit-column checker-audit-copy"><label class="checker-field-label" for="checkerBody"><span>正文</span><small>最多 5,000 字</small></label><textarea id="checkerBody" name="body" maxlength="5000" placeholder="粘贴或输入笔记正文。">${escape(draft.body || "")}</textarea><div class="checker-audit-actions"><button class="button primary" type="submit">开始 AI 检测</button></div></section></div>
      </form>${resultHtml(state.report)}`;
  }

  async function historyView() {
    if (!state.user) return loginRequired("登录后查看并跨设备保存完整检测记录。");
    const { audits } = await api("/audits");
    return `<section class="checker-page-head"><div><h3>历史检测记录</h3></div><button class="button primary" data-checker-action="select-tab" data-tab="audit">新建检测</button></section><div class="checker-history">${audits.length ? audits.map((audit) => `<details><summary><b>${escape(audit.title || "未命名检测")}</b><span>${escape(audit.platform === "DOUYIN" ? "抖音" : "小红书")}</span><span class="risk-badge risk-${escape(audit.overallRisk)}">${riskName(audit.overallRisk)} ${audit.score}</span><time>${date(audit.createdAt)}</time></summary><div class="checker-history-detail"><p><b>正文：</b>${escape(audit.body || "未填写")}</p>${(audit.issues || []).map((issue) => `<article><span class="risk-badge risk-${escape(issue.severity)}">${riskName(issue.severity)}</span><b>${escape(issue.category)}</b><p>证据：${escape(issue.evidence)}</p><p>建议：${escape(issue.suggestion)}</p></article>`).join("")}</div></details>`).join("") : "<p class=\"checker-empty\">还没有云端检测记录。</p>"}</div>`;
  }

  const knowledgePoints = knowledge.map((practice) => `- ${practice.category}：${practice.title}。${practice.summary}`).join("\n");
  const knowledgePrompt = (sourceCopy = "") => `你是一名内容优化专家。请结合以下内容创作与账号运营知识，优化我提供的中文文案。\n\n【知识库参考】\n${knowledgePoints}\n\n【优化要求】\n1. 保留原文真实意图和核心信息，不编造事实、数据或承诺。\n2. 使用自然、易懂、有吸引力的中文表达；重点和结论前置，避免平淡、空泛或营销腔。\n3. 如原文不利于平台内容传播，请结合知识库指出可改进之处。\n4. 输出必须使用以下结构：\n   - 优化后标题\n   - 优化后正文\n   - 优化建议（3 条以内，说明具体改动原因）\n   - 可选封面/前五秒文案\n\n【待优化原文】\n${sourceCopy || "{{用户文案}}"}`;

  function knowledgeAction(action) {
    if (action === "封面参考") return `<a class="checker-knowledge-link" href="https://qcnj3k0hgb3d.feishu.cn/wiki/MP7twGNgCiOeakkv4rmc1Z1vnYB?from=from_copylink" rel="noreferrer" target="_blank">✅优秀封面参考</a>`;
    return escape(action);
  }

  function knowledgeView() {
    return `<section class="checker-knowledge-hero"><div><h2>正向实践知识库</h2><p>将你的文案放入优化提示词，带着知识库原则向 AI 获取更具体的改写建议。</p><button class="button primary" type="button" data-checker-action="open-knowledge-prompt">生成 AI 优化提示词</button></div></section><section class="checker-knowledge">${knowledge.map((practice) => `<article class="knowledge-card"><div class="knowledge-card-top"><span class="knowledge-number">${practice.number}</span><span class="knowledge-category">${escape(practice.category)}</span></div><h3>${escape(practice.title)}</h3><p>${escape(practice.summary)}</p>${practice.context ? `<p>${escape(practice.context)}</p>` : ""}<div class="knowledge-divider"></div><b>建议这样做</b><ul>${practice.actions.map((action) => `<li>${knowledgeAction(action)}</li>`).join("")}</ul></article>`).join("")}</section><div id="knowledgePromptModal" class="knowledge-modal-backdrop hidden" aria-labelledby="knowledgePromptTitle" aria-modal="true" role="dialog"><section class="knowledge-modal"><div class="knowledge-modal-head"><h2 id="knowledgePromptTitle">生成优化提示词</h2><button class="knowledge-modal-close" type="button" aria-label="关闭弹窗" data-checker-action="close-knowledge-prompt"><span class="app-icon icon-close" aria-hidden="true"></span></button></div><label for="knowledgeSourceCopy">你的文案</label><textarea id="knowledgeSourceCopy" class="knowledge-prompt-input" placeholder="粘贴或输入需要优化的中文文案" rows="5">${escape(state.knowledgeSourceCopy)}</textarea><div class="knowledge-modal-actions"><p id="knowledgePromptStatus" aria-live="polite"></p><div><button class="button" type="button" data-checker-action="close-knowledge-prompt">取消</button><button class="button primary" type="button" data-checker-action="copy-knowledge-prompt">复制提示词</button></div></div></section></div>`;
  }

  async function practiceView() {
    if (!state.user) return loginRequired("登录后访问实操库文章。");
    const { articles } = await api("/practice"); state.articles = articles;
    return `<section class="checker-practice-hero"><div><span>practice library</span><h2>实操库</h2><p>将可直接应用的内容技巧整理为文章，打开就能照着做。</p><form id="checkerPracticeSearch"><input name="q" placeholder="按标题搜索" type="search" /><button class="button primary" type="submit">搜索</button></form></div></section><section class="checker-practice-list"><div class="checker-practice-list-head"><p>全部实操文章</p><span>${articles.length} 篇</span></div><div class="checker-articles">${articles.length ? articles.map((article) => `<button data-checker-action="article" data-id="${escape(article.id)}"><h3>${escape(article.title)}</h3><span>发布时间 ${date(article.publishedAt)}</span></button>`).join("") : "<p class=\"checker-empty\">暂无实操文章。</p>"}</div></section>`;
  }

  function practiceArticleView() {
    const article = state.article;
    if (!article) return "";
    return `<section class="checker-article-page"><button class="checker-article-back" type="button" data-checker-action="back-to-practice"><span class="app-icon icon-back" aria-hidden="true"></span>返回实操库</button><article><span>practice</span><h2>${escape(article.title)}</h2><p class="checker-article-date">发布时间 ${date(article.publishedAt)}</p><div class="editor-preview practice-markdown">${renderMarkdown(article.body)}</div></article></section>`;
  }

  function membershipView() {
    if (!state.user) return loginRequired("登录后查看你的套餐与审核额度。");
    const plans = [["FREE", "免费版", "¥0", "3 次完整审核 / 月", "标题与正文规则检测 · 最近 7 天记录"], ["PRO", "专业版", "¥39", "100 次完整审核 / 月", "1–18 张图片多模态审核 · 完整历史记录"], ["TEAM", "团队版", "¥199", "800 次完整审核 / 月", "5 个成员席位 · 优先模型队列与 API"]];
    return `<section class="checker-page-head"><div><h3>会员中心</h3></div></section><div class="checker-plans">${plans.map(([id, name, price, quota, features]) => `<article class="${state.user.plan === id ? "active" : ""}"><h3>${name}</h3><strong>${price}<small> / 月</small></strong><p>${quota}</p><p>${features}</p><button class="button ${state.user.plan === id ? "" : "primary"}" disabled>${state.user.plan === id ? "当前方案" : "支付接入后启用"}</button></article>`).join("")}</div>`;
  }

  async function adminView() {
    const { articles } = await api("/admin/practice");
    return `<section class="checker-page-head"><div><h3>管理实操库</h3></div></section><div class="checker-admin-grid"><form id="checkerArticleForm" class="checker-form"><input type="hidden" name="id" /><label>标题<input name="title" maxlength="160" required /></label><label>状态<select name="status"><option value="DRAFT">草稿</option><option value="PUBLISHED">发布</option><option value="OFFLINE">下线</option></select></label><div class="checker-markdown-field"><div class="checker-markdown-label"><label for="checkerArticleBody">正文</label><small>支持 Markdown，右侧可实时预览</small></div><textarea id="checkerArticleBody" name="body" required placeholder="开始撰写文章…"></textarea></div><div class="checker-form-actions"><button class="button primary" type="submit">保存文章</button><button class="button" type="button" data-checker-action="new-article">新建</button></div></form><div class="checker-admin-list">${articles.map((article) => `<button data-checker-action="edit-article" data-article="${escape(encodeURIComponent(JSON.stringify(article)))}"><span>${escape(article.status)} · ${date(article.updatedAt)}</span><b>${escape(article.title)}</b></button>`).join("") || "暂无文章"}</div></div>`;
  }

  function loginRequired(message) { return `<section class="checker-login-required"><h3>${escape(message)}</h3><button class="button primary" data-checker-action="show-login">登录</button><button class="button" data-checker-action="show-register">注册</button></section>`; }
  function loginView() { return `<form id="checkerAuthForm" class="checker-auth-form" data-auth-mode="login"><h3>登录</h3><label>邮箱 <input name="email" type="email" autocomplete="email" required /></label><label>密码 <input name="password" type="password" autocomplete="current-password" minlength="8" required /></label><div><button class="button primary" type="submit">登录</button><button class="button" type="button" data-checker-action="show-register">去注册</button><button class="button" type="button" data-checker-action="back">返回</button></div></form>`; }
  function registerView() { return `<form id="checkerAuthForm" class="checker-auth-form" data-auth-mode="register"><h3>注册</h3><label>邮箱 <input name="email" type="email" autocomplete="email" required /></label><label>密码 <input name="password" type="password" autocomplete="new-password" minlength="8" required /></label><div><button class="button primary" type="submit">注册</button><button class="button" type="button" data-checker-action="show-login">去登录</button><button class="button" type="button" data-checker-action="back">返回</button></div></form>`; }

  async function render() {
    renderAuth();
    const content = document.getElementById("checkerContent"); if (!content) return;
    window.dispatchEvent(new CustomEvent("content-checker-tabchange", { detail: { tab: state.tab } }));
    try {
      let html;
      if (state.tab === "login") html = loginView(); else if (state.tab === "register") html = registerView(); else if (state.tab === "audit") html = auditView(); else if (state.tab === "history") html = await historyView(); else if (state.tab === "knowledge") html = knowledgeView(); else if (state.tab === "practice") html = await practiceView(); else if (state.tab === "article") html = practiceArticleView(); else if (state.tab === "membership") html = membershipView(); else html = await adminView();
      state.articleEditor?.toTextArea();
      state.articleEditor = null;
      content.innerHTML = html;
      bindFormEvents();
    } catch (error) { content.innerHTML = `<p class="checker-empty">读取失败：${escape(error.message)}</p>`; status(error.message, true); }
  }

  function updateImagePreviews(files) {
    state.previews.forEach((image) => URL.revokeObjectURL(image.src));
    state.auditFiles = [...(files || [])].slice(0, 18);
    state.previews = state.auditFiles.map((file) => ({ name: file.name, src: URL.createObjectURL(file) }));
    const target = document.getElementById("checkerPreviews");
    const dropzone = document.querySelector(".checker-upload-dropzone");
    const title = document.querySelector("[data-upload-title]");
    if (target) target.innerHTML = state.previews.map((image) => `<img src="${escape(image.src)}" alt="${escape(image.name)}" />`).join("");
    dropzone?.classList.toggle("has-files", state.previews.length > 0);
    if (title) title.textContent = state.previews.length ? `已选择 ${state.previews.length} 张图片` : "点击选择或拖拽图片至此";
  }

  function validAuditImageUrl(value) {
    const url = String(value || "").trim();
    return /^(?:https?:|data:image\/)/i.test(url) ? url : "";
  }

  async function imageFilesFromUrls(imageUrls) {
    const files = [];
    let skipped = 0;
    for (const [index, source] of imageUrls.slice(0, 18).entries()) {
      const url = validAuditImageUrl(source);
      if (!url) { skipped += 1; continue; }
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error("图片读取失败");
        const blob = await response.blob();
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(blob.type) || blob.size > 10 * 1024 * 1024) throw new Error("图片格式或大小不支持");
        const extension = blob.type === "image/png" ? "png" : blob.type === "image/webp" ? "webp" : "jpg";
        files.push(new File([blob], `创作计划图片-${index + 1}.${extension}`, { type: blob.type }));
      } catch {
        skipped += 1;
      }
    }
    return { files, skipped };
  }

  async function prefillAudit(input = {}) {
    const title = String(input.title || "").trim().slice(0, 120);
    const body = String(input.body || "").trim().slice(0, 5000);
    const imageUrls = Array.isArray(input.images) ? input.images : [];
    const { files, skipped } = await imageFilesFromUrls(imageUrls);
    state.report = null;
    updateImagePreviews(files);
    const imageMessage = files.length ? `，并带入 ${files.length} 张图片` : "";
    const skippedMessage = skipped ? `；${skipped} 张图片无法读取，请手动上传` : "";
    state.auditDraft = {
      title,
      body,
      importedMessage: `已从创作计划带入标题和正文${imageMessage}${skippedMessage}。`
    };
    state.tab = "audit";
    await render();
  }

  function bindFormEvents() {
    const imageInput = document.getElementById("checkerImages");
    const dropzone = document.querySelector(".checker-upload-dropzone");
    imageInput?.addEventListener("change", (event) => updateImagePreviews(event.target.files));
    ["dragenter", "dragover"].forEach((type) => dropzone?.addEventListener(type, (event) => { event.preventDefault(); dropzone.classList.add("is-dragging"); }));
    ["dragleave", "drop"].forEach((type) => dropzone?.addEventListener(type, (event) => { event.preventDefault(); dropzone.classList.remove("is-dragging"); }));
    dropzone?.addEventListener("drop", (event) => { const files = event.dataTransfer?.files; if (!files?.length) return; try { imageInput.files = files; } catch { /* Preview remains available even where the browser blocks assignment. */ } updateImagePreviews(files); });
    document.getElementById("checkerAuditForm")?.addEventListener("submit", submitAudit);
    document.getElementById("checkerAuthForm")?.addEventListener("submit", submitAuth);
    document.getElementById("checkerPracticeSearch")?.addEventListener("submit", searchPractice);
    document.getElementById("checkerArticleForm")?.addEventListener("submit", saveArticle);
    document.getElementById("knowledgePromptModal")?.addEventListener("mousedown", (event) => { if (event.target === event.currentTarget) event.currentTarget.classList.add("hidden"); });
    const articleBody = document.getElementById("checkerArticleBody");
    if (articleBody && window.EasyMDE) { state.articleEditor = new window.EasyMDE({ element: articleBody, minHeight: "500px", sideBySideFullscreen: false, spellChecker: false, nativeSpellcheck: true, renderingConfig: { sanitizerFunction: sanitizeMarkdownHtml }, toolbar: ["heading", "bold", "italic", "strikethrough", "|", "quote", "unordered-list", "ordered-list", "task", "|", "link", "image", "table", "code", "|", "preview", "side-by-side", "fullscreen", "guide"] }); state.articleEditor.toggleSideBySide(); }
    if (imageInput && state.auditFiles.length) updateImagePreviews(state.auditFiles);
  }

  async function submitAudit(event) { event.preventDefault(); const form = new FormData(event.currentTarget); form.delete("images"); state.auditFiles.forEach((file) => form.append("images", file, file.name)); status("正在综合审核…"); try { state.report = await api("/audits", { method: "POST", body: form }); await render(); status(state.report.historyScope === "account" ? "检测完成，已保存到你的账户。" : "检测完成；登录后可保存到云端记录。"); document.getElementById("checkerResult")?.scrollIntoView({ behavior: "smooth", block: "start" }); } catch (error) { status(error.message, true); } }
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
    if (type === "open-knowledge-prompt") { document.getElementById("knowledgePromptModal")?.classList.remove("hidden"); document.getElementById("knowledgeSourceCopy")?.focus(); return; }
    if (type === "close-knowledge-prompt") { document.getElementById("knowledgePromptModal")?.classList.add("hidden"); return; }
    if (type === "copy-knowledge-prompt") { const source = document.getElementById("knowledgeSourceCopy"); const message = document.getElementById("knowledgePromptStatus"); state.knowledgeSourceCopy = source?.value || ""; try { await navigator.clipboard.writeText(knowledgePrompt(state.knowledgeSourceCopy)); if (message) message.textContent = "提示词已复制，可直接粘贴给 AI。"; } catch { if (message) message.textContent = "复制失败，请手动选中提示词复制。"; } return; }
    if (type === "article") { try { const { article } = await api(`/practice/${action.dataset.id}`); state.article = article; state.tab = "article"; await render(); window.scrollTo({ top: 0, behavior: "smooth" }); } catch (error) { status(error.message, true); } return; }
    if (type === "back-to-practice") { state.tab = "practice"; await render(); return; }
    if (type === "new-article") { const form = document.getElementById("checkerArticleForm"); form?.reset(); state.articleEditor?.value(""); }
    if (type === "edit-article") { const article = JSON.parse(decodeURIComponent(action.dataset.article)); const form = document.getElementById("checkerArticleForm"); form.elements.id.value = article.id; form.elements.title.value = article.title; form.elements.status.value = article.status; state.articleEditor?.value(article.body); window.scrollTo({ top: form.getBoundingClientRect().top + window.scrollY - 80, behavior: "smooth" }); }
  });

  window.ContentChecker = {
    async init() { try { await refreshUser(); } catch (error) { status(`审核功能暂不可用：${error.message}`, true); } finally { renderAuth(); } },
    async show(tab) { if (tab) state.tab = tab; await this.init(); await render(); },
    async selectTab(tab) { state.tab = tab || "audit"; await render(); },
    prefillAudit
  };
})();
