// Otari Guard - unit tests for the guard pipeline (lib/guard.js) using a
// stub model caller, so no network and no funds are involved.
// Run with: npm test

const test = require("node:test");
const assert = require("node:assert/strict");
const { createPolicy } = require("../lib/policy");
const { DEFAULT_PRICES } = require("../lib/prices");
const { guardRequest, defaultState, DEFAULT_ROLES } = require("../lib/guard");

const FLASH = "deepseek/deepseek-v4.1-flash";
const PRO = "deepseek/deepseek-v4-pro-0813";

// A controllable stub caller. outcomes is a map from model id to either
// { reply, usage } or an Error to throw. Every call is recorded in calls.
function makeStub(outcomes) {
  const calls = [];
  const callModel = async ({ model }) => {
    calls.push(model);
    const outcome = outcomes[model];
    if (outcome instanceof Error) throw outcome;
    if (outcome) return { reply: outcome.reply, usage: outcome.usage, model, simulated: false };
    throw new Error(`stub has no outcome for ${model}`);
  };
  return { calls, callModel };
}

function okReply(usage) {
  return {
    reply: "Hello from the stub.",
    usage: usage || { prompt_tokens: 2, completion_tokens: 10, total_tokens: 12 },
  };
}

function basePolicy(overrides) {
  return createPolicy({
    perCallCapUsd: 0.05,
    dailyCapUsd: 1.0,
    confirmAboveUsd: 0.02,
    allowlist: [FLASH, PRO, "openai:gpt-5"],
    ...(overrides || {}),
  });
}

function run(requestOverrides, policyOverrides, stateOverrides, stubOutcomes) {
  const stub = makeStub(stubOutcomes || { [FLASH]: okReply(), [PRO]: okReply() });
  return guardRequest({
    request: { user: "alice", role: "triage", prompt: "hello", ...(requestOverrides || {}) },
    policy: basePolicy(policyOverrides),
    state: { ...defaultState(), ...(stateOverrides || {}) },
    prices: DEFAULT_PRICES,
    roles: DEFAULT_ROLES,
    callModel: stub.callModel,
  }).then((result) => ({ result, calls: stub.calls }));
}

test("allowed call returns a reply and updates the ledger and state", async () => {
  const { result, calls } = await run();
  assert.equal(result.decision, "ALLOWED");
  assert.equal(result.reply, "Hello from the stub.");
  assert.equal(result.modelUsed, FLASH);
  assert.equal(result.fallbackUsed, false);
  assert.equal(result.simulated, false);
  assert.deepEqual(calls, [FLASH]);
  assert.equal(result.ledgerEntry.outcome, "allowed");
  assert.equal(result.ledgerEntry.user, "alice");
  assert.equal(result.ledgerEntry.modelUsed, FLASH);
  // Actual cost: (2 * 0.1 + 10 * 0.4) / 1e6 = 0.0000042
  assert.ok(Math.abs(result.actualCostUsd - 0.0000042) < 1e-12, `got ${result.actualCostUsd}`);
  assert.ok(Math.abs(result.state.spentTotalUsd - 0.0000042) < 1e-12);
  assert.ok(Math.abs(result.state.spentByUser.alice - 0.0000042) < 1e-12);
});

test("allowlist block records a blocked ledger entry and calls nothing", async () => {
  const { result, calls } = await run(
    {},
    { allowlist: ["openai:gpt-5"] },
    {},
    { [FLASH]: okReply(), [PRO]: okReply() }
  );
  assert.equal(result.decision, "BLOCKED");
  assert.equal(result.rule, "allowlist");
  assert.equal(result.reply, null);
  assert.equal(result.modelUsed, null);
  assert.deepEqual(calls, []);
  assert.equal(result.ledgerEntry.outcome, "blocked");
  assert.equal(result.ledgerEntry.rule, "allowlist");
  assert.match(result.ledgerEntry.reason, /not on your allowlist/);
});

test("per-call cap block records a blocked ledger entry and calls nothing", async () => {
  const { result, calls } = await run({}, { perCallCapUsd: 0.00005 });
  assert.equal(result.decision, "BLOCKED");
  assert.equal(result.rule, "perCallCap");
  assert.deepEqual(calls, []);
  assert.equal(result.ledgerEntry.outcome, "blocked");
  assert.equal(result.ledgerEntry.rule, "perCallCap");
});

test("daily cap block records a blocked ledger entry and calls nothing", async () => {
  const { result, calls } = await run(
    {},
    { dailyCapUsd: 0.0001 },
    { spentTotalUsd: 0.00009, spentByUser: {} }
  );
  assert.equal(result.decision, "BLOCKED");
  assert.equal(result.rule, "dailyCap");
  assert.deepEqual(calls, []);
  assert.equal(result.ledgerEntry.outcome, "blocked");
});

test("per-user budget block records a blocked ledger entry and calls nothing", async () => {
  const { result, calls } = await run(
    {},
    { perUserBudgets: { alice: 0.0001 } },
    { spentTotalUsd: 0, spentByUser: { alice: 0.00009 } }
  );
  assert.equal(result.decision, "BLOCKED");
  assert.equal(result.rule, "perUserBudget");
  assert.deepEqual(calls, []);
  assert.equal(result.ledgerEntry.outcome, "blocked");
  assert.equal(result.ledgerEntry.rule, "perUserBudget");
});

test("confirm threshold returns needs-confirmation, then allows after confirmation", async () => {
  const pending = await run({}, { confirmAboveUsd: 0.00005 });
  assert.equal(pending.result.decision, "NEEDS_CONFIRMATION");
  assert.equal(pending.result.rule, "confirmThreshold");
  assert.equal(pending.result.reply, null);
  assert.deepEqual(pending.calls, []);
  assert.equal(pending.result.ledgerEntry.outcome, "needs-confirmation");

  const confirmed = await run({ confirmed: true }, { confirmAboveUsd: 0.00005 });
  assert.equal(confirmed.result.decision, "ALLOWED");
  assert.equal(confirmed.result.reply, "Hello from the stub.");
  assert.equal(confirmed.result.ledgerEntry.outcome, "allowed");
});

test("fallback: a retryable 500 on the primary tries the next model", async () => {
  const error500 = new Error("Otari request failed: 500 Internal Server Error");
  error500.status = 500;
  const { result, calls } = await run(
    {},
    {},
    {},
    { [FLASH]: error500, [PRO]: okReply() }
  );
  assert.equal(result.decision, "ALLOWED");
  assert.equal(result.fallbackUsed, true);
  assert.equal(result.modelUsed, PRO);
  assert.deepEqual(calls, [FLASH, PRO]);
  assert.equal(result.ledgerEntry.outcome, "fallback used");
  assert.match(result.ledgerEntry.reason, /fell back/);
});

test("no fallback on a 402: the call is blocked and only tried once", async () => {
  const error402 = new Error("Otari request failed: 402 Payment Required");
  error402.status = 402;
  const { result, calls } = await run(
    {},
    {},
    {},
    { [FLASH]: error402, [PRO]: okReply() }
  );
  assert.equal(result.decision, "BLOCKED");
  assert.equal(result.rule, "gatewayError");
  assert.equal(result.modelUsed, null);
  assert.equal(result.reply, null);
  assert.deepEqual(calls, [FLASH]);
  assert.equal(result.ledgerEntry.outcome, "blocked");
  assert.match(result.ledgerEntry.reason, /402/);
});

test("a model with no price entry is blocked before any call", async () => {
  const stub = makeStub({ "mystery:model": okReply() });
  const result = await guardRequest({
    request: { user: "alice", role: "triage", model: "mystery:model", prompt: "hello" },
    policy: basePolicy({ allowlist: [] }),
    state: defaultState(),
    prices: DEFAULT_PRICES,
    roles: DEFAULT_ROLES,
    callModel: stub.callModel,
  });
  assert.equal(result.decision, "BLOCKED");
  assert.equal(result.rule, "unknownPrice");
  assert.deepEqual(stub.calls, []);
  assert.equal(result.ledgerEntry.outcome, "blocked");
});

test("an explicit model overrides the role chain", async () => {
  const { result, calls } = await run({ model: PRO });
  assert.equal(result.decision, "ALLOWED");
  assert.equal(result.modelUsed, PRO);
  assert.deepEqual(calls, [PRO]);
});
