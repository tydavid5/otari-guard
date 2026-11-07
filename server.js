// Otari Guard - local server. Plain Node http, no framework, no build step.
// Serves the UI from public/ and runs the guard pipeline on POST /api/chat.
// The Otari API key stays server-side only: it is read from the environment
// (or a local .env file) and is never returned in any response, never logged.

const http = require("http");
const fs = require("fs");
const path = require("path");
const { loadPrices, loadRoles, loadPolicy, policyToJson, policyFromJson } = require("./lib/config");
const { guardRequest, defaultState } = require("./lib/guard");
const { callOtari, simulateResponse } = require("./lib/otari");

// Minimal .env loader: only sets keys that are not already in the env,
// and never logs any value.
function loadDotEnv(file) {
  try {
    const text = fs.readFileSync(file, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (key && !(key in process.env)) process.env[key] = value;
    }
  } catch {
    // No .env file: real environment variables are used instead.
  }
}
loadDotEnv(path.join(__dirname, ".env"));

const PORT = Number(process.env.PORT || 8000);
const BASE_URL = String(process.env.OTARI_BASE_URL || "https://api.otari.ai/api").replace(/\/$/, "");
const API_KEY = process.env.OTARI_API_KEY || "";
const MODE = API_KEY ? "live" : "demo";

const prices = loadPrices(process.env);
const roles = loadRoles(process.env);
let policy = loadPolicy(process.env);
let state = defaultState();
let ledger = [];

function healthPayload() {
  return {
    mode: MODE,
    baseUrl: BASE_URL,
    hasKey: Boolean(API_KEY),
    roles,
    models: Object.keys(prices),
    prices,
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 1024 * 1024) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function readJson(req) {
  const text = await readBody(req);
  if (!text.trim()) return {};
  return JSON.parse(text);
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

function serveStatic(req, res) {
  const urlPath = req.url.split("?")[0];
  const relPath = urlPath === "/" ? "index.html" : urlPath.replace(/^\//, "");
  const publicDir = path.join(__dirname, "public");
  const filePath = path.resolve(publicDir, relPath);
  if (!filePath.startsWith(publicDir + path.sep) && filePath !== publicDir) {
    sendJson(res, 404, { error: "Not found" });
    return;
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      sendJson(res, 404, { error: "Not found" });
      return;
    }
    res.writeHead(200, {
      "Content-Type": CONTENT_TYPES[path.extname(filePath)] || "application/octet-stream",
      "Content-Length": data.length,
    });
    res.end(data);
  });
}

async function handleChat(req, res) {
  let body;
  try {
    body = await readJson(req);
  } catch {
    sendJson(res, 400, { error: "Invalid JSON body" });
    return;
  }
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) {
    sendJson(res, 400, { error: "prompt is required" });
    return;
  }
  const user = typeof body.user === "string" && body.user.trim() ? body.user.trim() : "alice";
  const role = body.role === "code" ? "code" : "triage";
  const model = typeof body.model === "string" && body.model.trim() ? body.model.trim() : undefined;

  const callModel = async ({ model: callModelName, messages }) => {
    if (MODE === "live") {
      return callOtari({ baseUrl: BASE_URL, apiKey: API_KEY, model: callModelName, messages });
    }
    const sim = simulateResponse({ role, prompt: messages[0].content });
    return { ...sim, model: callModelName };
  };

  const result = await guardRequest({
    request: { user, role, model, prompt, confirmed: body.confirmed === true },
    policy,
    state,
    prices,
    roles,
    callModel,
  });
  state = result.state;
  ledger.push(result.ledgerEntry);
  sendJson(res, 200, {
    ...result,
    mode: MODE,
    error: result.error ? result.error.message : null,
  });
}

async function handlePolicy(req, res) {
  if (req.method === "GET") {
    sendJson(res, 200, policyToJson(policy));
    return;
  }
  if (req.method === "POST") {
    let body;
    try {
      body = await readJson(req);
    } catch {
      sendJson(res, 400, { error: "Invalid JSON body" });
      return;
    }
    const next = policyFromJson(body);
    if (!next) {
      sendJson(res, 400, { error: "Policy must be an object with caps, allowlist and per-user budgets" });
      return;
    }
    policy = next;
    sendJson(res, 200, policyToJson(policy));
    return;
  }
  sendJson(res, 405, { error: "Method not allowed" });
}

const server = http.createServer((req, res) => {
  const urlPath = req.url.split("?")[0];
  if (urlPath === "/api/health" && req.method === "GET") {
    sendJson(res, 200, healthPayload());
    return;
  }
  if (urlPath === "/api/policy") {
    handlePolicy(req, res).catch(() => sendJson(res, 500, { error: "Server error" }));
    return;
  }
  if (urlPath === "/api/state" && req.method === "GET") {
    sendJson(res, 200, state);
    return;
  }
  if (urlPath === "/api/ledger" && req.method === "GET") {
    sendJson(res, 200, ledger);
    return;
  }
  if (urlPath === "/api/chat" && req.method === "POST") {
    handleChat(req, res).catch((error) => {
      sendJson(res, 500, { error: `Server error: ${error.message}` });
    });
    return;
  }
  if (req.method === "GET") {
    serveStatic(req, res);
    return;
  }
  sendJson(res, 404, { error: "Not found" });
});

server.listen(PORT, () => {
  console.log(`Otari Guard listening on http://localhost:${PORT} (mode: ${MODE})`);
});

module.exports = server;
