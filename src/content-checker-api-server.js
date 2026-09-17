const path = require("path");
const express = require("express");
const { loadEnv } = require("./env");
const { createContentCheckerRouter } = require("./content-checker-router");

// Database credentials belong to the API process, never to the dashboard.
// Process environment still takes precedence over either file.
loadEnv(process.env.CONTENT_CHECKER_API_ENV_FILE || path.resolve(__dirname, "..", ".env.content-checker-api"));
loadEnv();

const port = Number(process.env.CONTENT_CHECKER_API_PORT || 5179);
const host = process.env.CONTENT_CHECKER_API_HOST || "127.0.0.1";
const allowedOrigins = new Set(
  String(process.env.CONTENT_CHECKER_ALLOWED_ORIGINS || "http://localhost:5178,http://127.0.0.1:5178")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
);

function applyCors(req, res) {
  const origin = req.get("origin");
  if (!origin || !allowedOrigins.has(origin)) return false;
  res.set("Access-Control-Allow-Origin", origin);
  res.set("Access-Control-Allow-Credentials", "true");
  res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, OPTIONS");
  res.vary("Origin");
  return true;
}

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  res.set("X-Content-Type-Options", "nosniff");
  res.set("Referrer-Policy", "no-referrer");
  const allowed = applyCors(req, res);
  if (req.method === "OPTIONS") {
    if (!allowed) return res.sendStatus(403);
    return res.sendStatus(204);
  }
  return next();
});
app.use(express.json({ limit: "2mb" }));
app.use("/api/content-checker", createContentCheckerRouter({ projectRoot: path.resolve(__dirname, "..") }));
app.get("/health", (req, res) => res.json({ ok: true, service: "content-checker-api" }));

app.listen(port, host, () => {
  console.log("Content checker API: http://" + host + ":" + port);
});
