// Price map for cost estimates, USD per 1M tokens.
// These are estimates, not live rates: the gateway itself bills the real
// amount, and every cost Otari Guard shows is labelled as an estimate.
// Override the whole map with OTARI_PRICES_JSON, e.g.
// OTARI_PRICES_JSON='{"deepseek/deepseek-v4.1-flash":{"inputPerMillion":0.1,"outputPerMillion":0.4}}'
// Models verified against the live Otari docs (mozilla-ai/otari,
// docs/models.md and docs/quickstart.md, commit
// 84f0ecde977fddc09b26aa9f37e9e24665d3ef5b):
// - deepseek/deepseek-v4.1-flash: catalog id example in models.md, DeepSeek
//   is open-weight, flash tier is the fast and cheap variant.
// - deepseek/deepseek-v4-pro-0813: the model the official quickstart itself
//   uses in its example request, DeepSeek open-weight.
// - openai:gpt-5: provider:model example in models.md.
// The gateway's own GET /api/v1/models is the authoritative list for a
// deployment; if a model id here ever stops being served, set the model
// list with OTARI_TRIAGE_MODEL, OTARI_CODE_MODEL and OTARI_ALLOWLIST.

const DEFAULT_PRICES = {
  "deepseek/deepseek-v4.1-flash": { inputPerMillion: 0.1, outputPerMillion: 0.4 },
  "deepseek/deepseek-v4-pro-0813": { inputPerMillion: 0.5, outputPerMillion: 2.0 },
  "openai:gpt-5": { inputPerMillion: 1.25, outputPerMillion: 10.0 },
};

function loadPrices(env) {
  const source = env || process.env;
  if (source.OTARI_PRICES_JSON) {
    try {
      const parsed = JSON.parse(source.OTARI_PRICES_JSON);
      const merged = { ...DEFAULT_PRICES };
      for (const [model, price] of Object.entries(parsed)) {
        if (
          price &&
          typeof price.inputPerMillion === "number" &&
          typeof price.outputPerMillion === "number"
        ) {
          merged[model] = price;
        }
      }
      return merged;
    } catch {
      return DEFAULT_PRICES;
    }
  }
  return DEFAULT_PRICES;
}

module.exports = { DEFAULT_PRICES, loadPrices };
