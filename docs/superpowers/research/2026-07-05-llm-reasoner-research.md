# Skynet — Research: LLM "Reasoner" advising a deterministic orchestrator

**Date:** 2026-07-05
**Type:** Research / discovery (not a spec — no implementation planned yet)
**Question:** Should Skynet's orchestration layer stay fully deterministic,
or should a deterministic Mediator consult an LLM **Reasoner** (over HTTP,
on API-key models) for judgment-heavy sub-decisions — task-to-worker
routing, standup summaries, retro-driven replanning?
**Related:** [ARCHITECTURE.md](../../ARCHITECTURE.md) (hexagonal core,
`Orchestrator` Mediator, `MatchingStrategy`),
[2026-07-02-skynet-discovery.md](../specs/2026-07-02-skynet-discovery.md)
(Risks → Legal/ToS, pty-only mitigation), [CONSTITUTION.md](../../../CONSTITUTION.md).

---

## Verdict

**Adopt the Reasoner pattern — as an advisory port the deterministic
Mediator consults, never as an LLM that runs orchestration.** The evidence
supports exactly the split proposed: keep coordination, state, and gates
deterministic; use an LLM only for bounded, fallback-guarded judgment.
Run it over HTTP on **API-key** models only — legally clean and
categorically distinct from the subscription-auth pattern the pty rule
guards against. Ship it behind one OpenAI-compatible adapter, one call
site first (suitability matching), with a mandatory deterministic fallback.

Confidence: **high** on the architecture split and the legal distinction;
**medium** on model/cost specifics (fast-moving, single-sourced numbers).

### Method / confidence caveat

Research ran the deep-research harness (5 angles, 23 sources, 91 extracted
claims). The adversarial verification pass was **cut short by a session
rate-limit** — only 3 of 25 candidate claims got the full 3-vote check;
the rest are **sourced but not harness-verified** (throttled, *not*
refuted). Claims below are tagged: **[verified]** (3-0 adversarial),
**[refuted]** (killed), **[sourced]** (primary/secondary source, not
independently verified here). Re-running verification after the limit
resets would upgrade the [sourced] tags; the verdict does not hinge on any
single one of them.

---

## 1. Prior art — is "deterministic orchestrator + LLM judgment" a real pattern?

Yes. It is the pattern the most robust frameworks converge on, and the
empirical failure data explains why.

- **[verified]** *Most multi-agent failures are coordination/specification,
  not base-model quality.* The MAST taxonomy (UC Berkeley Sky Lab, 1600+
  annotated traces across 7 frameworks) sorts failures into system-design,
  inter-agent misalignment, and verification — 14 modes. Coordination and
  verification breakdowns dominate. Source: arxiv.org/abs/2503.13657.
  **Implication:** the layer most likely to fail is the *coordination*
  layer — so that is the layer to keep deterministic. An LLM buys nothing
  there and adds a failure surface. It earns its place only in the narrow
  judgment cells.
- **[verified]** *MetaGPT hardcodes orchestration as SOPs* (fixed role
  sequence, output schemas, retry logic); LLM agents operate *within* those
  constraints rather than driving the flow. This is precisely the proposed
  split, in a production framework. Source: arxiv.org/html/2308.00352v6.
- **[sourced]** *Learned routing is feasible.* MasRouter formalizes
  multi-agent routing (collaboration mode, role allocation, per-agent model
  choice) as a trained controller — evidence that task-to-worker routing
  *can* be delegated to a model rather than hardcoded. Source:
  arxiv.org/pdf/2502.11133 (also reports up to ~52% overhead reduction vs
  SOTA on HumanEval — single-sourced, treat as directional).
- **[sourced]** *Orchestration structure itself is protective.* Formal
  orchestration frameworks reported ~3.2× lower failure vs unorchestrated
  multi-agent systems; unorchestrated systems failed >40%. Largest failure
  category (~42%) was spec/design. Source: augmentcode.com guide (blog).

**Read:** the frameworks that work don't let the LLM run the show — they
box it inside deterministic procedure. Skynet's instinct (Mediator + state
machine deterministic, LLM consulted for judgment) matches the surviving
design, not the failing one.

## 2. Legal / ToS — API-key brain vs subscription arbitrage

The Reasoner runs on **genuine API keys**, which is categorically clean and
*not* the pattern the discovery doc's pty rule guards against.

- **[sourced]** Anthropic's own Legal & Compliance doc: OAuth
  (subscription) tokens are **exclusively** for Free/Pro/Max plan holders
  using native Anthropic apps; developers building products/services
  (including via the Agent SDK) **must use API-key auth** via Console or a
  supported cloud provider. Source: code.claude.com/docs/en/legal-and-compliance.
- **[sourced]** The banned conduct is **subscription arbitrage / resale /
  service-bureau passthrough** — routing third-party users' requests
  through subscription tokens — not the act of calling the API. API-key
  usage falls under Commercial Terms with *no automation restrictions*.
  Sources: theregister.com (2026-02-20), sitepoint.com, autonomee.ai,
  groundy.com. This is the OpenClaw line: OpenClaw died on subscription
  OAuth; genuine API keys were never the target.
- **Distinction that matters for Skynet:** the pty rule exists because
  the **workers** use *subscription* auth (that's the whole cost thesis).
  The Reasoner uses *API keys* the developer/user owns, for the developer's
  *own* internal coordination logic — not resale, not passthrough, not
  subscription tokens. Different terms, different risk class.

**Per-provider (all [sourced], verify keys/ToS at build time):**
GLM-5.2/Zhipu, DeepSeek, OpenAI platform, NVIDIA NIM, OpenRouter, local
Ollama — all sell/expose genuine API-key access intended for automation.
No subscription-arbitrage entanglement. The only ToS surface is each
provider's ordinary API terms (rate limits, acceptable use), not the
enforcement pattern that shaped the constitution.

**Constitution consequence:** CONSTITUTION.md currently bans provider
SDK/API-client deps for *agent orchestration*, pty-only. This research
recommends a **bounded carve-out**, written explicitly: HTTP/API-key
access is permitted **only behind a `Reasoner` port** (developer/user's own
API keys, orchestration judgment). The `AgentProvider` port (workers) stays
pty-only, forever, and the Reasoner **never** touches subscription-auth
credentials. Without that written boundary, a future adapter author sneaks
HTTP into the worker layer.

## 3. Wire format — does one adapter cover them all?

**[sourced] Largely yes.** GLM/Zhipu, DeepSeek, NVIDIA NIM, OpenRouter, and
Ollama all expose an **OpenAI chat-completions-compatible** endpoint. One
`openai-compatible` adapter (base URL + API key + model id per profile)
covers all of them — N models by config, not N adapters.

Caveats (all [sourced]):
- **Structured output is not uniform.** OpenAI Structured Outputs uses
  constrained decoding for guaranteed schema adherence
  (openai.com/index/introducing-structured-outputs-in-the-api). DeepSeek
  offers JSON mode. Ollama takes a JSON-schema `format` / `response_format`.
  GLM-5 reported "very stable when the schema is well-defined." Reliability
  and the exact knob differ per provider — the adapter must normalize
  "ask for JSON matching this schema" and **always validate the result**,
  never trust it.
- **Edge incompatibilities exist.** A first-party NVIDIA forum report notes
  DeepSeek-on-NIM streaming tool-calls not continuing in an
  Anthropic-compatible workflow. Non-streaming structured calls are the
  safer bet for a Reasoner; avoid depending on streaming tool-call
  semantics being identical across providers.
- **[refuted]** The claim that structured/schema output *empirically
  reduces cascading failures* was **killed 0-3** — the MetaGPT paper
  asserts it but does not measure it. So: use structured output because
  constrained decoding is sound engineering and makes results
  machine-checkable — **not** on a proven-cascade-reduction basis.

## 4. Model selection for the orchestration brain

Orchestration judgment is short, cheap, latency-tolerant work — a strong
fit for cheap fast models, not frontier ones. **All [sourced], single-run
numbers — directional, re-check at build time:**

- **Cost (per 1M tokens, in/out):** GLM-5.1 ≈ $1.05 / $3.50; DeepSeek
  V4-Flash ≈ $0.14/M-class; GPT-5.5 ≈ $5 / $30; Claude Opus ≈ $5 / $25.
  Orchestration calls are small and frequent — the cheap tier (GLM,
  DeepSeek) is the obvious default; frontier only if judgment quality
  measurably falls short.
- **Latency (TTFT, medium prompt):** ~450ms (Gemini Flash) to ~2400ms
  (GPT-4.1 Mini); Haiku-4.5 ≈ 597ms, Sonnet-4 ≈ 900ms. All acceptable for a
  non-interactive routing/summary decision. Latency is not a differentiator
  here; structured-output reliability and cost are.
- **Practical pattern seen in the wild ([sourced]):** sticky routing — pin
  a stronger model for planning/replanning, a cheap one for summarization,
  swap per task. Skynet's config-per-profile design supports this directly.

**Default recommendation:** GLM-5.2 or DeepSeek as the standard Reasoner
brain; OpenAI/GPT as a configurable higher-quality fallback for
replanning; local Ollama for offline/dev. Model choice is config, not code.

## 5. Failure modes and mandatory mitigations

Putting an LLM in *any* loop imports its failure modes. Contain them:

- **Nondeterminism / unstable routing.** Same input, different routing
  decision across runs. Mitigation: **deterministic fallback is
  mandatory** — every Reasoner call has a hardcoded heuristic it degrades
  to on failure, timeout, low confidence, or schema-invalid output. The
  LLM is an *enhancement layer*; the board never stalls because GLM is
  down or hallucinated.
- **Cascade amplification ([sourced]).** In multi-agent loops a single bad
  output can propagate to system-level false consensus (vulnerability
  classes: cascade amplification, topological sensitivity, consensus
  inertia — arxiv.org/pdf/2603.04474). Mitigation: the Reasoner is
  **advisory and leaf-level** — it returns a value to the Mediator, it does
  not talk to other agents or feed its own output back unchecked. Gates
  stay deterministic (**[sourced]** recommended mitigation: schema-validation
  gates + deterministic boolean exit gates + external artifact as truth
  source, not local LLM judgment).
- **Hallucinated structure.** Mitigation: structured output + **validate
  every response against the schema**; invalid → fallback. Never act on an
  unvalidated Reasoner answer.
- **Confidence.** Where the Reasoner can express low confidence (or the
  validated answer is ambiguous), route to the deterministic path rather
  than guess.

## Recommendation (scope for a future spec — not built by this doc)

1. **`Reasoner` port** in a new core-pure `src/reasoning/` (no vscode, no
   pty, no HTTP in the port itself): `reason<T>(req) → ReasoningResult<T>`.
2. **One `openai-compatible` adapter** (`src/reasoning/adapters/`) — GLM,
   DeepSeek, OpenRouter, NIM, Ollama, OpenAI by config. Keys via VSCode
   SecretStorage at the edge. Always validate responses against schema.
3. **One call site first:** suitability scoring as an LLM `MatchingStrategy`
   impl (fits the existing E4 `MatchingStrategy` port — zero new seam),
   behind a deterministic fallback strategy. Standups (F6.4) and
   retro→replan (F6.5) are later consumers, not first-spec scope.
4. **Constitution amendment:** bounded HTTP carve-out for the `Reasoner`
   port only; `AgentProvider` stays pty-only; Reasoner never touches
   subscription auth.
5. **Deterministic fallback is a hard requirement**, not a nice-to-have,
   at every call site.

## Open items to re-check before writing a spec

- Re-run the throttled verification pass (session limit reset) to upgrade
  the [sourced] legal and wire-format claims to [verified].
- Confirm GLM-5.2 / DeepSeek current pricing and structured-output knobs
  against live docs (numbers here are single-run and fast-moving).
- Probe one OpenAI-compatible endpoint for real (constitution's
  probe-before-building rule) to confirm the schema/validation path before
  committing the adapter shape.

## Sources (primary first)

- arxiv.org/abs/2503.13657 — MAST failure taxonomy (primary) **[verified basis]**
- arxiv.org/html/2308.00352v6 — MetaGPT / SOPs (primary) **[verified basis]**
- arxiv.org/pdf/2502.11133 — MasRouter, learned MAS routing (primary)
- arxiv.org/pdf/2603.04474 — error-cascade vulnerability classes (primary)
- code.claude.com/docs/en/legal-and-compliance — Anthropic auth policy (primary)
- openai.com/index/introducing-structured-outputs-in-the-api — constrained decoding (primary)
- docs.ollama.com/capabilities/structured-outputs — Ollama schema output (primary)
- theregister.com (2026-02-20) — Anthropic third-party access clarification (secondary)
- groundy.com, sitepoint.com, autonomee.ai — API-key vs subscription terms (blog)
- augmentcode.com/guides/multi-agent-orchestration-architecture-guide — orchestration failure figures + mitigations (blog)
- wavespeed.ai, flowtivity.ai, kunalganglani.com — GLM/DeepSeek/GPT cost & latency (blog)
- forums.developer.nvidia.com/t/…/368085 — DeepSeek-on-NIM streaming tool-call caveat (forum, first-party report)
