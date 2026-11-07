// Otari Guard - Otari gateway client (live) and deterministic simulator (demo).
// Live calls go to the hosted gateway at OTARI_BASE_URL, chat completions
// endpoint POST /v1/chat/completions, Bearer token auth, OpenAI-compatible
// request and response shapes. Verified against the live Otari docs
// (mozilla-ai/otari, docs/quickstart.md and docs/models.md).

const DEFAULT_TIMEOUT_MS = 90000;

function isRetryableError(error) {
  if (!error) return false;
  if (error.name === "AbortError" || error.code === "ETIMEDOUT") return true;
  if (typeof error.status === "number") {
    return error.status === 429 || error.status >= 500;
  }
  if (error.code === "ECONNRESET" || error.code === "ENOTFOUND" || error.code === "EAI_AGAIN") {
    return true;
  }
  return false;
}

// One live chat completion. Returns { reply, usage, model } where usage is
// the gateway usage block { prompt_tokens, completion_tokens, total_tokens }.
// Throws an Error with .status and .body on a non-2xx response, so the
// caller can decide whether to fall back to another model.
async function callOtari({ baseUrl, apiKey, model, messages, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const url = `${String(baseUrl).replace(/\/$/, "")}/v1/chat/completions`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model, messages }),
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timer);
    throw error;
  }
  clearTimeout(timer);
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const error = new Error(`Otari request failed: ${response.status} ${body.slice(0, 300)}`);
    error.status = response.status;
    error.body = body.slice(0, 500);
    throw error;
  }
  const data = await response.json();
  const reply =
    data && data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content
      : "";
  return {
    reply: typeof reply === "string" ? reply : "",
    usage: data && data.usage ? data.usage : null,
    model: (data && data.model) || model,
  };
}

// Deterministic simulated reply for demo mode. Clearly labelled simulated
// everywhere it is used; never presented as a live gateway response.
// The reply is derived from the prompt so repeated prompts behave the same.
function simulateResponse({ role, prompt }) {
  const text = String(prompt || "").trim();
  const firstWords = text.split(/\s+/).slice(0, 8).join(" ");
  const reply =
    role === "code"
      ? `Simulated code reply for: ${firstWords}. In live mode this would be the model's answer to your coding question, with real tokens and a real cost.`
      : `Simulated reply for: ${firstWords}. In live mode this would be the model's answer, with real tokens and a real cost.`;
  const promptTokens = Math.max(1, Math.ceil(text.length / 4));
  const completionTokens = Math.max(1, Math.ceil(reply.length / 4));
  return {
    reply,
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
    model: null,
    simulated: true,
  };
}

module.exports = { callOtari, simulateResponse, isRetryableError, DEFAULT_TIMEOUT_MS };
