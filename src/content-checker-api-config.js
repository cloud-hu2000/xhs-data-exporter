function isLoopbackHost(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
}

/**
 * Returns the separately deployed content-checker API base URL.
 *
 * The dashboard deliberately has no database fallback.  Keeping this setting
 * explicit prevents a local dashboard process from ever acquiring database
 * credentials or opening a database connection.
 */
function contentCheckerApiBase(env = process.env) {
  const raw = String(env.XHS_CONTENT_CHECKER_API_BASE || "").trim();
  if (!raw) return null;

  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("XHS_CONTENT_CHECKER_API_BASE 必须是完整的 HTTP(S) API 地址。");
  }

  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash || url.search) {
    throw new Error("XHS_CONTENT_CHECKER_API_BASE 只能使用不含凭据、查询参数或片段的 HTTP(S) 地址。");
  }
  if (url.protocol !== "https:" && !isLoopbackHost(url.hostname)) {
    throw new Error("远程发布前检测 API 必须使用 HTTPS；仅本机回环地址可使用 HTTP。");
  }

  return url.toString().replace(/\/$/, "");
}

module.exports = { contentCheckerApiBase };
