# Submission kit — Build, Ship, Shape 2026 (Alexa+ track)

Deadline: **October 23, 2026, 12:00 PM PT**. Judging Nov 9–20. This file holds the Devpost text, the video plan, and the mini-challenge entries so nothing is written in a hurry on the last day.

## Devpost — project name
**Custodian — the household inventory that keeps watch**

## Devpost — tagline (≤ 120 chars)
Tell Alexa what you own; Custodian watches it for recalls and reminds you what your home needs — hands-free, on Echo Show.

## Devpost — inspiration / what it does / how we built it

**Inspiration.** Recall remedy rates are dismal because the notice reaches the wrong place at the wrong time — an email from a brand you forgot. The device that *is* in the room when you strap in a car seat or change a filter is the one that should know. Alexa+ is shared by the whole household, hands-free, and now speaks MCP.

**What it does.** You say "I just bought a Graco 4Ever car seat" or "we have a 2019 Honda Odyssey". Custodian stores it, infers brand and category, and continuously cross-references CPSC, NHTSA and FDA recall feeds. "Alexa, is anything in my house recalled?" answers in one sentence with the hazard and the remedy, and shows the notice, the affected models and a one-tap "I've handled it" on Echo Show. It also tracks the small things that keep a home safe — smoke-detector batteries, filters, car-seat expiry, vehicle service, warranties — and "anything I should know about?" gives a briefing of what's new and what's due.

**How we built it.** A self-hosted MCP server (TypeScript SDK v2, MCP 2025-11-25 over Streamable HTTP) with a hand-built OAuth 2.1 authorization server in the exact two-tier shape Alexa+ account linking requires (client-credentials + PKCE code flow, rotating refresh tokens, `resource` parameter, no DCR). Tools never touch the network: a background sweeper pulls the feeds into a MiniSearch index, scores matches deterministically with a written reason, and asks Claude on Amazon Bedrock (structured outputs) only for the ambiguous band. One content-hashed MCP App bundle renders five views following the Alexa+ MCP design guide. AWS: App Runner + DynamoDB + Secrets Manager via CDK.

**Challenges.** Alexa+'s auth shape doesn't match generic MCP OAuth libraries; the 500 ms budget forced an "answer from the store, work in the background" architecture; and the public recall feeds have real data-quality problems (a CPSC record carrying another recall's title; null-y NHTSA rows) that the matcher had to be hardened against. All logged in `FRICTION_LOG.md`.

**What's next.** Login with Amazon for account linking, proactive notifications when Alexa+ exposes them, barcode/receipt intake from the Alexa app, and per-member reminders.

## Track + mini-challenges
- Primary: **Alexa+** (self-hosted MCP server, spec 2025-11-25, Streamable HTTP, OAuth 2.1, MCP Apps)
- **AWS Builder**: Claude on Amazon Bedrock (Mantle endpoint, structured outputs) for item normalization and match adjudication; App Runner, DynamoDB, Secrets Manager via CDK
- **Open Source**: MIT, public repo created and built entirely within the submission window (see commit history)

## Video (< 3:00) — shot list
1. **0:00–0:15** Cold open on an Echo Show in a kitchen. "Alexa, is anything in my house recalled?" → spoken answer + recall card appears. Title card: *Custodian*.
2. **0:15–0:45** The problem in three sentences over B-roll of a recall email/notice. "Recalls fail because the notice never reaches the room where the product lives."
3. **0:45–1:30** Live demo, real device, real data: add a car seat by voice → briefing → recall details → tap "I've handled it" → "what needs doing at home?" (maintenance timeline) → "I changed the smoke detector batteries."
4. **1:30–2:15** How it works (one diagram): MCP server ↔ Alexa+, sweeper + feeds, 500 ms rule, OAuth shape, MCP App. Show `/metrics.json` latency and the OAuth conformance script passing.
5. **2:15–2:45** AWS: `cdk deploy` output, Bedrock adjudication example (an ambiguous match the model vetoes with a reason).
6. **2:45–3:00** Close: repo, friction log, "everything you own, watched."

Record device footage with the Alexa app's development-stage add-on enabled; capture the Echo Show at 1080p from a tripod, plus screen recording of the simulator as backup.

## Product feedback (required field)
- Tools used: Alexa+ MCP Toolkit docs, `alexa-ai` CLI, Local Inspector, web simulator; MCP TypeScript SDK v2; ext-apps SDK + basic-host; Bedrock.
- What worked: bring-your-own MCP server is the right abstraction; MCP Apps on the Show is a genuine step up from text; the design guide's card/list patterns map cleanly onto tool outputs.
- What needs improvement: see `FRICTION_LOG.md` (private-registry CLI, doc link 404s, protocol-version drift, no reference OAuth server, display-mode declaration ambiguity).
- Onboarding: the Agent Skill path is promising; the CodeArtifact prerequisite should be on the QuickStart.

## Feature requests
1. A reference OAuth 2.1 authorization server (or conformance test) for the two-tier Alexa+ model.
2. Proactive notifications from add-ons ("a new recall matched something you own").
3. A documented capability matrix for the Alexa+ MCP client (elicitation, sampling, tasks, notifications).
4. Publish `@alexa-ai/*` to the public npm registry.
