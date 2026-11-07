// Otari Guard - configuration from environment, shared by the local server
// and the Vercel serverless function, so both run the same defaults.

const { loadPrices } = require("./prices");
const { createPolicy } = require("./policy");

function parseNumber(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function parseAllowlist(value, prices) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return Object.keys(prices);
  }
  return String(value)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function parsePerUserBudgets(value) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const out = {};
      for (const [user, budget] of Object.entries(parsed)) {
        const n = Number(budget);
        if (Number.isFinite(n) && n >= 0) out[user] = n;
      }
      return out;
    }
  } catch {
    // Fall through to an empty map; a bad env value never blocks startup.
  }
  return {};
}

function loadRoles(env) {
  const source = env || process.env;
  const triage = String(source.OTARI_TRIAGE_MODEL || "deepseek/deepseek-v4.1-flash").trim();
  const triageFallback = String(
    source.OTARI_TRIAGE_FALLBACK_MODEL || "deepseek/deepseek-v4-pro-0813"
  ).trim();
  const code = String(source.OTARI_CODE_MODEL || "deepseek/deepseek-v4-pro-0813").trim();
  const codeFallback = String(source.OTARI_CODE_FALLBACK_MODEL || "openai:gpt-5").trim();
  return {
    triage: { label: "Triage, short replies", chain: [triage, triageFallback] },
    code: { label: "Code and complex work", chain: [code, codeFallback] },
  };
}

function loadPolicy(env) {
  const source = env || process.env;
  const prices = loadPrices(source);
  return createPolicy({
    perCallCapUsd: parseNumber(source.OTARI_PER_CALL_CAP, 0.05),
    dailyCapUsd: parseNumber(source.OTARI_DAILY_CAP, 1.0),
    confirmAboveUsd: parseNumber(source.OTARI_CONFIRM_ABOVE, 0.02),
    allowlist: parseAllowlist(source.OTARI_ALLOWLIST, prices),
    perUserBudgets: parsePerUserBudgets(source.OTARI_PER_USER_BUDGETS_JSON),
  });
}

// Plain JSON form of a policy, for API responses and for the browser to
// send back to a stateless function.
function policyToJson(policy) {
  return {
    perCallCapUsd: policy.perCallCapUsd,
    dailyCapUsd: policy.dailyCapUsd,
    confirmAboveUsd: policy.confirmAboveUsd,
    allowlist: [...policy.allowlist],
    perUserBudgets: { ...policy.perUserBudgets },
  };
}

// Rebuild a policy from a JSON body. Returns null when the body is not a
// usable policy object, so callers can fall back to the env defaults.
function policyFromJson(json) {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const perCallCapUsd = parseNumber(json.perCallCapUsd, 0.05);
  const dailyCapUsd = parseNumber(json.dailyCapUsd, 1.0);
  const confirmAboveUsd = parseNumber(json.confirmAboveUsd, 0.02);
  const allowlist = Array.isArray(json.allowlist)
    ? json.allowlist.filter((m) => typeof m === "string" && m.trim()).map((m) => m.trim())
    : [];
  const perUserBudgets = {};
  if (json.perUserBudgets && typeof json.perUserBudgets === "object") {
    for (const [user, budget] of Object.entries(json.perUserBudgets)) {
      const n = Number(budget);
      if (Number.isFinite(n) && n >= 0) perUserBudgets[user] = n;
    }
  }
  return createPolicy({ perCallCapUsd, dailyCapUsd, confirmAboveUsd, allowlist, perUserBudgets });
}

module.exports = { loadPrices, loadRoles, loadPolicy, policyToJson, policyFromJson };
