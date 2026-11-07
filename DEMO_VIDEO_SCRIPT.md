# Otari Guard - demo video script (3 to 5 minutes)

For Five to record himself. The rubric requires a screen recording with the
participant's own voice, and no AI narration, so record this on your phone:
open https://otari-guard.vercel.app/ in the browser, start the screen
recorder, and talk through the steps below. Keep the demo mode banner
visible throughout and say it out loud, the video must be honest that the
demo runs on simulated responses while the Otari account is unfunded.
Target length: about 4 minutes 30 seconds. Do not rush the clicks, let each
result show on screen for a few seconds.

## 0:00 - 0:30 The problem

Show the README on GitHub (https://github.com/tydavid5/otari-guard).

Say: "Developers who hand an AI agent an LLM API key have no way to stop
one runaway loop from burning their whole budget, so a single bad prompt can
spend in minutes what was meant to last a month. Otari Guard fixes that. It
sits between your code and the Otari gateway and enforces spend and safety
policy on every call, before the call is made."

## 0:30 - 1:00 The app

Open https://otari-guard.vercel.app/.

Say: "This is the live demo. The banner says demo mode, simulated
responses, no live Otari calls, because my Otari account is not funded yet,
and I will not pretend otherwise. Here is the policy panel: a per-call cap
of 5 cents, a daily cap of 1 dollar, and a confirm threshold of 2 cents.
Here are the per-user budgets, and here is the ledger, which records every
call, including the blocked ones."

## 1:00 - 2:00 A call that passes

In the Playground, set user to "five", role to "Triage, short replies",
and type: "Explain what a budget cap is in one sentence." Press Run.

Say: "This call passes. The Guard estimated the cost first, about a tenth
of a cent, checked it against every rule, and only then called the model.
The reply is simulated in demo mode, and the ledger shows it: allowed, the
model used, the tokens, and the estimated and actual cost. The budget meter
moves."

## 2:00 - 3:00 A call that needs confirmation

In the policy panel, lower "confirm above" to 0.00005 dollars, then run the
same prompt again.

Say: "Now the same call needs confirmation, because its estimated cost is
above the threshold I just set. The Guard does not run it. It waits. Press
Confirm, and it runs. That is the step that stops a runaway loop: the
expensive call cannot happen without a human saying yes."

Set "confirm above" back to 0.02.

## 3:00 - 3:45 A blocked call

In the policy panel, lower the per-call cap to 0.00005 dollars, then run
the prompt again.

Say: "Now the call is blocked. The estimated cost is over the per-call cap,
so the Guard refuses it before any money moves, and the ledger records the
exact rule that stopped it. Nothing is silently dropped."

Set the per-call cap back to 0.05.

## 3:45 - 4:15 The code and the Otari integration

Show the repo, open lib/otari.js and lib/policy.js briefly.

Say: "Underneath, the Guard calls Otari's hosted gateway, one
OpenAI-compatible endpoint, with the model named as provider and model, for
example deepseek slash deepseek-v4.1-flash, an open-weight model. Triage
uses the cheap open-weight model, code work uses the stronger one, and if a
model fails, the Guard falls back to the next one in the chain. The policy
engine is 23 unit tests, all passing, and the first commit on the
devs-wilding branch is the Otari integration."

## 4:15 - 4:30 The honest close

Back on the live demo.

Say: "The Guard is real and it works. The one thing it cannot do yet is a
live call, because my Otari account holds zero dollars, and live calls are
refused until it is funded. When it is funded, the same demo switches to
live mode with no code change. That is Otari Guard: a guard that stops the
spend before it happens."

## Recording checklist

- Record in one take if you can; a small pause is fine, a scripted voiceover
  is not allowed, so speak live while you click.
- Keep the demo mode banner in frame the whole time.
- Do not show the API key anywhere. The key is not in the app, the repo, or
  the video.
- Save the video, upload it as Unlisted to the YouTube account for
  0x5ive@gmail.com (handle @arc5ive), not to the History in Plain Sight
  channel, and send the link back here.
