// Otari Guard - unit tests for the policy engine (lib/policy.js).
// Run with: npm test

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createPolicy,
  estimatePromptTokens,
  estimateCostUsd,
  actualCostUsd,
} = require("../lib/policy");
const { DEFAULT_PRICES } = require("../lib/prices");

const MODEL = "deepseek/deepseek-v4.1-flash";

test("allowlist blocks a model that is not listed", () => {
  const policy = createPolicy({ allowlist: ["openai:gpt-5"] });
  const result = policy.check({
    estimatedCostUsd: 0.001,
    model: MODEL,
    user: "alice",
  });
  assert.equal(result.decision, "BLOCKED");
  assert.equal(result.rule, "allowlist");
  assert.match(result.reason, /not on your allowlist/);
});

test("allowlist allows a listed model", () => {
  const policy = createPolicy({ allowlist: [MODEL] });
  const result = policy.check({ estimatedCostUsd: 0.001, model: MODEL, user: "alice" });
  assert.equal(result.decision, "ALLOWED");
});

test("empty allowlist means no restriction", () => {
  const policy = createPolicy({ allowlist: [] });
  const result = policy.check({ estimatedCostUsd: 0.001, model: "anything:at-all", user: "alice" });
  assert.equal(result.decision, "ALLOWED");
});

test("per-call cap blocks a call whose estimate is over the cap", () => {
  const policy = createPolicy({ perCallCapUsd: 0.00005, allowlist: [MODEL] });
  const result = policy.check({
    estimatedCostUsd: 0.0001026,
    model: MODEL,
    user: "alice",
  });
  assert.equal(result.decision, "BLOCKED");
  assert.equal(result.rule, "perCallCap");
});

test("daily cap blocks a call that would take the day over the cap", () => {
  const policy = createPolicy({ dailyCapUsd: 0.0001, allowlist: [MODEL] });
  const result = policy.check({
    estimatedCostUsd: 0.0001026,
    model: MODEL,
    user: "alice",
    spentTodayUsd: 0.00009,
  });
  assert.equal(result.decision, "BLOCKED");
  assert.equal(result.rule, "dailyCap");
});

test("per-user budget blocks a call that would take the user over budget", () => {
  const policy = createPolicy({
    dailyCapUsd: 1.0,
    allowlist: [MODEL],
    perUserBudgets: { alice: 0.0001 },
  });
  const result = policy.check({
    estimatedCostUsd: 0.0001026,
    model: MODEL,
    user: "alice",
    spentTodayUsd: 0,
    spentTodayByUserUsd: 0.00009,
  });
  assert.equal(result.decision, "BLOCKED");
  assert.equal(result.rule, "perUserBudget");
});

test("per-user budget does not block a different user", () => {
  const policy = createPolicy({
    dailyCapUsd: 1.0,
    allowlist: [MODEL],
    perUserBudgets: { alice: 0.0001 },
  });
  const result = policy.check({
    estimatedCostUsd: 0.0001026,
    model: MODEL,
    user: "bob",
    spentTodayUsd: 0,
    spentTodayByUserUsd: 0,
  });
  assert.equal(result.decision, "ALLOWED");
});

test("confirm threshold returns needs-confirmation, then allows after confirmation", () => {
  const policy = createPolicy({
    perCallCapUsd: 0.05,
    dailyCapUsd: 1.0,
    confirmAboveUsd: 0.00005,
    allowlist: [MODEL],
  });
  const pending = policy.check({
    estimatedCostUsd: 0.0001026,
    model: MODEL,
    user: "alice",
    confirmed: false,
  });
  assert.equal(pending.decision, "NEEDS_CONFIRMATION");
  assert.equal(pending.rule, "confirmThreshold");

  const confirmed = policy.check({
    estimatedCostUsd: 0.0001026,
    model: MODEL,
    user: "alice",
    confirmed: true,
  });
  assert.equal(confirmed.decision, "ALLOWED");
});

test("estimatePromptTokens is about 4 chars per token, at least 1", () => {
  assert.equal(estimatePromptTokens(""), 1);
  assert.equal(estimatePromptTokens("hello"), 2);
  assert.equal(estimatePromptTokens("a".repeat(400)), 100);
});

test("estimateCostUsd returns null for an unknown model", () => {
  assert.equal(estimateCostUsd("nope:not-a-model", "hello", DEFAULT_PRICES), null);
});

test("estimateCostUsd uses prompt tokens plus the assumed completion", () => {
  const cost = estimateCostUsd(MODEL, "hello", DEFAULT_PRICES);
  // 2 prompt tokens at 0.1 per 1M plus 256 completion tokens at 0.4 per 1M.
  assert.ok(Math.abs(cost - 0.0001026) < 1e-9, `got ${cost}`);
});

test("actualCostUsd uses the real usage block", () => {
  const cost = actualCostUsd(MODEL, { prompt_tokens: 100, completion_tokens: 50 }, DEFAULT_PRICES);
  // (100 * 0.1 + 50 * 0.4) / 1e6 = 0.00003
  assert.ok(Math.abs(cost - 0.00003) < 1e-12, `got ${cost}`);
});

test("actualCostUsd returns null without a price or without usage", () => {
  assert.equal(actualCostUsd("nope:not-a-model", { prompt_tokens: 1, completion_tokens: 1 }, DEFAULT_PRICES), null);
  assert.equal(actualCostUsd(MODEL, null, DEFAULT_PRICES), null);
});
