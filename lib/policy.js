// Otari Guard - spending policy engine (pure logic, no network, no funds).
// A call is either ALLOWED, BLOCKED (with the exact rule that stopped it),
// or NEEDS_CONFIRMATION (above the confirm threshold, below the cap).
// Ported semantics from a per-transaction policy engine; here the unit is
// one LLM call, so the per-transaction cap becomes a per-call cost cap.

const DECISIONS = ["ALLOWED", "BLOCKED", "NEEDS_CONFIRMATION"];

function createPolicy({
  perCallCapUsd = 0.05,
  dailyCapUsd = 1.0,
  confirmAboveUsd = 0.02,
  allowlist = [],
  perUserBudgets = {},
} = {}) {
  return {
    perCallCapUsd,
    dailyCapUsd,
    confirmAboveUsd,
    allowlist: new Set(allowlist),
    perUserBudgets: { ...perUserBudgets },

    // estimatedCostUsd: pre-call cost estimate for this call.
    // spentTodayUsd: total spent today across all users.
    // spentTodayByUserUsd: total spent today by this user.
    // confirmed: true when the user already confirmed this call in the UI.
    check({
      estimatedCostUsd,
      model,
      user,
      spentTodayUsd = 0,
      spentTodayByUserUsd = 0,
      confirmed = false,
    }) {
      if (this.allowlist.size > 0 && !this.allowlist.has(model)) {
        return {
          decision: "BLOCKED",
          reason: `Model ${model} is not on your allowlist, and new models need your approval first.`,
          rule: "allowlist",
        };
      }
      if (estimatedCostUsd > perCallCapUsd) {
        return {
          decision: "BLOCKED",
          reason: `Estimated cost $${estimatedCostUsd.toFixed(4)} exceeds the per-call cap of $${perCallCapUsd.toFixed(4)}.`,
          rule: "perCallCap",
        };
      }
      const userBudget =
        user && this.perUserBudgets[user] !== undefined
          ? this.perUserBudgets[user]
          : null;
      if (userBudget !== null && spentTodayByUserUsd + estimatedCostUsd > userBudget) {
        return {
          decision: "BLOCKED",
          reason: `This would take ${user} to $${(spentTodayByUserUsd + estimatedCostUsd).toFixed(4)} today, over their budget of $${userBudget.toFixed(4)}.`,
          rule: "perUserBudget",
        };
      }
      if (spentTodayUsd + estimatedCostUsd > dailyCapUsd) {
        return {
          decision: "BLOCKED",
          reason: `This would take today's spending to $${(spentTodayUsd + estimatedCostUsd).toFixed(4)}, over the daily cap of $${dailyCapUsd.toFixed(4)}.`,
          rule: "dailyCap",
        };
      }
      if (estimatedCostUsd > confirmAboveUsd && !confirmed) {
        return {
          decision: "NEEDS_CONFIRMATION",
          reason: `Estimated cost $${estimatedCostUsd.toFixed(4)} is above your $${confirmAboveUsd.toFixed(4)} confirmation threshold. Confirm to proceed.`,
          rule: "confirmThreshold",
        };
      }
      return { decision: "ALLOWED", reason: "Passes all spending rules.", rule: null };
    },
  };
}

// Estimate the token count of a prompt. Rough but honest: about 4 chars
// per token for English text. Used only for the pre-call estimate; the
// ledger always records the real usage block from the gateway afterwards.
function estimatePromptTokens(text) {
  return Math.max(1, Math.ceil(String(text || "").length / 4));
}

// Pre-call cost estimate. assumedCompletionTokens is a planning figure
// (default 256) because the real completion length is unknown before the
// call. Every estimate is labelled as an estimate in the UI and ledger.
function estimateCostUsd(model, promptText, prices, assumedCompletionTokens = 256) {
  const price = prices[model];
  if (!price) return null;
  const promptTokens = estimatePromptTokens(promptText);
  return (
    (promptTokens * price.inputPerMillion + assumedCompletionTokens * price.outputPerMillion) /
    1e6
  );
}

// Real cost from the gateway usage block. Returns null when the model has
// no price entry, so unknown prices never silently become zero.
function actualCostUsd(model, usage, prices) {
  const price = prices[model];
  if (!price || !usage) return null;
  const promptTokens = usage.prompt_tokens || 0;
  const completionTokens = usage.completion_tokens || 0;
  return (
    (promptTokens * price.inputPerMillion + completionTokens * price.outputPerMillion) /
    1e6
  );
}

module.exports = { createPolicy, estimatePromptTokens, estimateCostUsd, actualCostUsd, DECISIONS };
