# Otari Guard - written feedback (draft for Five to approve)

This is the written-feedback route for the Mozilla Otari hackathon submission.
It answers the three questions from the submission requirements, honestly,
from the actual build. Five: read it, edit anything that is not your voice,
and approve it before it goes into the form.

## 1. When were you most tempted to skip Otari and call the provider directly, and what happened?

Twice. The first time was when the Otari account showed a $0.00 balance and
every live call came back "402 Insufficient funds". The $20 in free tokens
for the first 200 sign-ups was not on the account, and nothing on the site
said the offer had ended, so the first real run just failed. The fastest way
to a working demo at that point would have been calling DeepSeek directly
and skipping the gateway entirely.

The second time was speed: the first request from my network timed out at
30 seconds, and a direct provider call would have answered faster.

What happened: I kept Otari. The Guard only makes sense as a gateway layer,
one endpoint, routing, usage metering, so dropping the gateway would have
meant dropping the project. Instead I built a labelled demo mode so the
whole policy flow could be shown honestly while the account was unfunded,
and the Guard proved itself on the failure: it recorded the 402 in the
ledger, did not retry it, and did not fall back to another model. The
gateway timeout was fixed by raising the client timeout to 90 seconds.

## 2. What did you build yourself that Otari should have done?

Four things, all on the developer side of the call, before it reaches the
gateway:

- A confirm-before-spend step. Otari enforces budgets at the key level, but
  there is no "ask me before this one call" step. Otari Guard estimates the
  cost first and holds any call above a threshold until the developer
  confirms it.
- Per-user budgets enforced before the call, with a plain-language reason
  when a call is blocked, for example "this would take Ada to $0.06 today,
  over her budget of $0.05".
- A local ledger that records every call, including blocked and
  needs-confirmation calls, so nothing is silently dropped. Otari meters
  usage after settlement; the Guard shows the estimate before the call and
  the real cost after it.
- A labelled demo mode, so the policy flow can be tried end to end without
  spending anything. The simulated replies are clearly marked as simulated.

None of these replace Otari's budgets. They sit in front of them, so a bad
prompt or a runaway loop is stopped before the gateway is ever charged.

## 3. Would you have continued using Otari if not required, and why?

Yes. One OpenAI-compatible endpoint for 40+ providers, real open-weight
models, and built-in usage and budget metering are exactly what a tool like
Otari Guard needs, and the gateway is what makes the Guard portable between
providers. The model routing and the usage block in the response are the two
features I would miss most if I went back to calling providers directly.

Two honest frictions, though. First, the free-tokens offer was not on the
account and nothing on the site said so, so my first run failed with no
clear next step; a clear note about credits and the minimum top-up on the
sign-up page would have saved an hour. Second, the gateway was slow from my
network on the first call. Neither is a reason to leave, but both are worth
fixing for the next developer who signs up.
