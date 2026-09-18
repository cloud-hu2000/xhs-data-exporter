const DEFAULT_CONTENT_CHECKER_API_BASE = "http://101.37.116.48:5178/api/content-checker";

/**
 * Returns the fixed separately deployed content-checker API base URL.
 */
function contentCheckerApiBase() {
  return DEFAULT_CONTENT_CHECKER_API_BASE;
}

module.exports = { DEFAULT_CONTENT_CHECKER_API_BASE, contentCheckerApiBase };
