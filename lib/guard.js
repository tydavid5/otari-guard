// Otari Guard - the guard pipeline.
// Pure logic around an injected model caller, so the same code runs in the
// local server, the Vercel proxy, and the unit tests (with a stub caller).
// Flow: resolve role to a model chain, estimate the cost, run the policy
// check, then only call the gateway when the policy allows it. On a
// retryable error (5xx, 429, timeout) the next model in the chain is tried.
// Every attempt is recorded in a ledger entry, including blocked and
// needs-confirmation calls, so nothing is silently dropped.

// Roles: each role has a primary model and a fallback chain. Model ids are
// the verified Otari ids from docs/models.md and docs/quickstart.md.
const DEFAULT_ROLES = {
  triage: {
    label: "Triage, short replies",
    chain: ["deepseek/deepseek-v4.1-flash", "deepseek/deepseek-v4-pro-0813"],
  },
  code: {
    label: "Code and complex work",
    chain: ["deepseek/deepseek-v4-pro-0813", "openai:gpt-5"],
  },
};

function defaultState() {
  return { day: new Date().toISOString().slice(0, 10), spentTotalUsd: 0, spentByUser: {} };
}

function cloneState(state) {
  return {
    day: state.day,
    spentTotalUsd: state.spentTotalUsd,
    spentByUser: { ...(state.spentByUser || {}) },
  };
}

let ledgerCounter = 0;
function makeLedgerEntry(fields) {
  ledgerCounter += 1;
  return {
    id: `call-${Date.now().toString(36)}-${ledgerCounter}`,
    at: new Date().toISOString(),
    ...fields,
  };
}

// request: { user, role, model (optional explicit model), prompt, confirmed }
// policy: a policy engine object from lib/policy.js
// state: { day, spentTotalUsd, spentByUser }
// prices: the price map from lib/prices.js
// callModel: async ({ model, messages }) => ({ reply, usage, model, simulated })
//   In live mode this calls the gateway; in demo mode it returns a simulated reply.
// Returns { decision, reason, rule, modelRequested, modelUsed, reply, usage,
//   estimatedCostUsd, actualCostUsd, fallbackUsed, simulated, ledgerEntry, state }
async function guardRequest({ request, policy, state, prices, roles, callModel }) {
  const { user, role, prompt, confirmed = false } = request;
  const roleDef = (roles || DEFAULT_ROLES)[role] || (roles || DEFAULT_ROLES).triage;
  const chain = request.model ? [request.model] : [...roleDef.chain];
  const modelRequested = chain[0];
  const messages = [{ role: "user", content: prompt }];

  const today = new Date().toISOString().slice(0, 10);
  const baseState = state && state.day === today ? cloneState(state) : defaultState();
  const spentTodayUsd = baseState.spentTotalUsd;
  const spentTodayByUserUsd = baseState.spentByUser[user] || 0;

  // Pre-call estimate on the first model in the chain.
  const { estimateCostUsd, actualCostUsd } = require("./policy");
  const estimatedCostUsd = estimateCostUsd(modelRequested, prompt, prices);
  if (estimatedCostUsd === null) {
    const ledgerEntry = makeLedgerEntry({
      user,
      role,
      modelRequested,
      modelUsed: null,
      promptTokens: null,
      completionTokens: null,
      estimatedCostUsd: null,
      actualCostUsd: null,
      outcome: "blocked",
      reason: `Model ${modelRequested} has no price entry, so its cost cannot be estimated.`,
      rule: "unknownPrice",
      fallbackUsed: false,
      simulated: false,
    });
    return {
      decision: "BLOCKED",
      reason: ledgerEntry.reason,
      rule: "unknownPrice",
      modelRequested,
      modelUsed: null,
      reply: null,
      usage: null,
      estimatedCostUsd: null,
      actualCostUsd: null,
      fallbackUsed: false,
      simulated: false,
      ledgerEntry,
      state: baseState,
    };
  }

  const check = policy.check({
    estimatedCostUsd,
    model: modelRequested,
    user,
    spentTodayUsd,
    spentTodayByUserUsd,
    confirmed,
  });

  if (check.decision !== "ALLOWED") {
    const ledgerEntry = makeLedgerEntry({
      user,
      role,
      modelRequested,
      modelUsed: null,
      promptTokens: null,
      completionTokens: null,
      estimatedCostUsd,
      actualCostUsd: null,
      outcome: check.decision === "BLOCKED" ? "blocked" : "needs-confirmation",
      reason: check.reason,
      rule: check.rule,
      fallbackUsed: false,
      simulated: false,
    });
    return {
      decision: check.decision,
      reason: check.reason,
      rule: check.rule,
      modelRequested,
      modelUsed: null,
      reply: null,
      usage: null,
      estimatedCostUsd,
      actualCostUsd: null,
      fallbackUsed: false,
      simulated: false,
      ledgerEntry,
      state: baseState,
    };
  }

  // Policy allows it: try the chain in order.
  const { isRetryableError } = require("./otari");
  let lastError = null;
  for (let i = 0; i < chain.length; i += 1) {
    const model = chain[i];
    try {
      const result = await callModel({ model, messages });
      const cost = actualCostUsd(model, result.usage, prices);
      const newState = cloneState(baseState);
      if (cost !== null) {
        newState.spentTotalUsd = +(newState.spentTotalUsd + cost).toFixed(8);
        newState.spentByUser[user] = +((newState.spentByUser[user] || 0) + cost).toFixed(8);
      }
      const ledgerEntry = makeLedgerEntry({
        user,
        role,
        modelRequested,
        modelUsed: result.model || model,
        promptTokens: result.usage ? result.usage.prompt_tokens : null,
        completionTokens: result.usage ? result.usage.completion_tokens : null,
        estimatedCostUsd,
        actualCostUsd: cost,
        outcome: i > 0 ? "fallback used" : "allowed",
        reason: i > 0 ? `Primary model failed, fell back to ${result.model || model}.` : "Passes all spending rules.",
        rule: null,
        fallbackUsed: i > 0,
        simulated: !!result.simulated,
      });
      return {
        decision: "ALLOWED",
        reason: ledgerEntry.reason,
        rule: null,
        modelRequested,
        modelUsed: result.model || model,
        reply: result.reply,
        usage: result.usage,
        estimatedCostUsd,
        actualCostUsd: cost,
        fallbackUsed: i > 0,
        simulated: !!result.simulated,
        ledgerEntry,
        state: newState,
      };
    } catch (error) {
      lastError = error;
      if (!isRetryableError(error) || i === chain.length - 1) {
        break;
      }
      // Retryable error and more models left: fall through to the next.
    }
  }

  const ledgerEntry = makeLedgerEntry({
    user,
    role,
    modelRequested,
    modelUsed: null,
    promptTokens: null,
    completionTokens: null,
    estimatedCostUsd,
    actualCostUsd: null,
    outcome: "blocked",
    reason: `Gateway call failed: ${lastError ? lastError.message : "unknown error"}`,
    rule: "gatewayError",
    fallbackUsed: false,
    simulated: false,
  });
  return {
    decision: "BLOCKED",
    reason: ledgerEntry.reason,
    rule: "gatewayError",
    modelRequested,
    modelUsed: null,
    reply: null,
    usage: null,
    estimatedCostUsd,
    actualCostUsd: null,
    fallbackUsed: false,
    simulated: false,
    ledgerEntry,
    state: baseState,
    error: lastError,
  };
}

module.exports = { guardRequest, defaultState, DEFAULT_ROLES };
