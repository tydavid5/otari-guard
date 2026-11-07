# Otari Guard

Developers who hand an AI agent an LLM API key have no way to stop one runaway loop from burning their whole budget, so a single bad prompt can spend in minutes what was meant to last a month.

Otari Guard is an open-source developer tool that sits between your code and the Otari hosted LLM gateway and enforces spend and safety policy on every call, before the call reaches the gateway. It is the guard you wish you had already installed the first time an agent looped on a bad prompt.

## How it works

Every call goes through the same pipeline, in this order:

1. **Pick a role.** Triage (short replies) or Code (complex work). Each role has a model chain: a primary model and a fallback.
2. **Estimate the cost.** The prompt length and an assumed completion size are priced from a small price map, so the guard can judge the call before it runs.
3. **Check the policy.** A per-call cost cap, a daily spend cap, a per-user budget, and an allowlist of models. Anything over a cap is blocked with the exact rule that stopped it. A call estimated above the confirmation threshold does not run at all until you confirm it in the UI.
4. **Call the gateway.** The request goes to the Otari hosted gateway at `https://api.otari.ai/api`, OpenAI-compatible chat completions, Bearer token auth. On a retryable error (5xx, 429, timeout) the next model in the chain is tried. A 402 insufficient funds is never retried.
5. **Record the ledger.** Every outcome is written to the ledger, including blocked and needs-confirmation calls, with the model, the tokens, the estimated cost, the real cost from the gateway usage block, and the reason. Nothing is silently dropped.

Costs are always estimates from the gateway usage block and the price map. The gateway bills the real amount.

## Otari features used

- **Budgets and spending limits:** a per-call cap and a daily cap, enforced before the call runs.
- **Guardrails:** an allowlist of models plus a confirm-above threshold, so a new model or an expensive call needs a human first.
- **Per-user budgets:** each named user or agent gets its own daily budget, tracked separately from the shared daily cap.
- **Model routing and fallbacks:** each role resolves to a chain of models, and a retryable failure moves to the next model in the chain.
- **Multiple models in distinct roles:** a cheap open-weight model for triage and a stronger model for code, chosen per task.
- **Open-weight models:** the default chains use DeepSeek open-weight models (`deepseek/deepseek-v4.1-flash` and `deepseek/deepseek-v4-pro-0813`), with `openai:gpt-5` as the code fallback.

## Try it

Live demo: https://otari-guard.vercel.app/ (Vercel, free tier). It runs in labelled demo mode with simulated responses until the Otari account behind it is funded.

Local, with a key:

```sh
git clone https://github.com/tydavid5/otari-guard.git
cd otari-guard
npm install
cp .env.example .env
# put your Otari API key in .env as OTARI_API_KEY
npm start
# open http://localhost:8000
```

Local, without a key: skip the `.env` step. The app runs in labelled demo mode with deterministic simulated replies, so the whole flow (caps, confirmations, blocks, ledger) can be tried with no key and no spend.

Tests:

```sh
npm test
```

## Live status

The hosted demo runs in labelled demo mode until the Otari account behind it is funded. The Otari API key used during development is valid (the gateway authenticates it), but the account balance is $0.00, so live calls return 402 insufficient funds. That is an account funding step, not a code problem: the guard correctly reports the 402, records it in the ledger, and does not fall back to another model. Fund the Otari account, set `OTARI_API_KEY` as a Vercel env var, and the same demo switches to live mode.

## Configuration

All of it is env vars, no code changes needed:

- `OTARI_API_KEY`: your Otari platform API key. No key means demo mode.
- `OTARI_BASE_URL`: default `https://api.otari.ai/api`.
- `OTARI_PER_CALL_CAP`, `OTARI_DAILY_CAP`, `OTARI_CONFIRM_ABOVE`: USD caps, defaults 0.05, 1.00, 0.02.
- `OTARI_ALLOWLIST`: comma separated model ids. Default is the three models in the price map.
- `OTARI_PER_USER_BUDGETS_JSON`: for example `{"alice": 0.10}`.
- `OTARI_TRIAGE_MODEL`, `OTARI_TRIAGE_FALLBACK_MODEL`, `OTARI_CODE_MODEL`, `OTARI_CODE_FALLBACK_MODEL`: override the role chains.
- `OTARI_PRICES_JSON`: override or extend the price map (USD per 1M tokens).

## Consent and data handling

Otari Guard sends your prompt to the Otari gateway, and that is the only place your data leaves the machine. The ledger is local: on the local server it lives in server memory, and on the hosted demo it lives in your browser's localStorage. The API key is read from the environment, kept server-side only, and never logged, never returned in any response, and never stored in the repo. The `.env` file is gitignored. No analytics, no tracking, no third party besides Otari itself.

## License

MIT.
