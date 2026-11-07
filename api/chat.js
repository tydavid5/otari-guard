// Otari Guard - Vercel serverless function for the hosted demo.
// Runs the same guard pipeline as the local server. Stateless: the browser
// sends its policy and spent state with each request and stores the ledger
// in localStorage. The Otari API key comes from a Vercel env var and never
// reaches the browser.

const { loadPrices, loadRoles, loadPolicy, policyFromJson } = require("../lib/config");
const { guardRequest, defaultState } = require("../lib/guard");
const { callOtari, simulateResponse } = require("../lib/otari");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      res.status(400).json({ error: "Invalid JSON body" });
      return;
    }
  }
  if (!body || typeof body !== "object") {
    res.status(400).json({ error: "Invalid JSON body" });
    return;
  }
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) {
    res.status(400).json({ error: "prompt is required" });
    return;
  }
  const user = typeof body.user === "string" && body.user.trim() ? body.user.trim() : "alice";
  const role = body.role === "code" ? "code" : "triage";
  const model = typeof body.model === "string" && body.model.trim() ? body.model.trim() : undefined;

  const apiKey = process.env.OTARI_API_KEY || "";
  const baseUrl = String(process.env.OTARI_BASE_URL || "https://api.otari.ai/api").replace(/\/$/, "");
  const mode = apiKey ? "live" : "demo";
  const prices = loadPrices(process.env);
  const roles = loadRoles(process.env);
  const policy = body.policy ? policyFromJson(body.policy) || loadPolicy(process.env) : loadPolicy(process.env);
  const state = body.state && typeof body.state === "object" && body.state.day ? body.state : defaultState();

  const callModel = async ({ model: callModelName, messages }) => {
    if (mode === "live") {
      return callOtari({ baseUrl, apiKey, model: callModelName, messages });
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
  res.status(200).json({
    ...result,
    mode,
    error: result.error ? result.error.message : null,
  });
};
