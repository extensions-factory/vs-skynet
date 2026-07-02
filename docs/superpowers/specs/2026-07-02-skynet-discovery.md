# Skynet — Discovery

**Date:** 2026-07-02
**Idea:** A VSCode extension that harnesses AI CLI agents (Claude Code, OpenAI Codex CLI, Google Antigravity CLI) as a fully-orchestrated Scrum team — multiple agents playing roles (PM, dev, QA) that collaborate inside the IDE to ship software. Key claimed differentiators: subscription auth instead of API keys for cost control, multi-account management per provider, provider priority Codex → Antigravity → Claude Code, and a Scrum-team framing for the agent harness.

## tl;dr

The market opportunity (AI coding tools, multi-agent workflows, cost-conscious devs) is large and growing. But the specific product as scoped has two serious problems surfaced by research:

1. **The core cost-saving mechanism (subscription auth instead of API keys, spread across multiple accounts) is now a live ToS enforcement target for headless/SDK usage.** Anthropic has already taken action against a directly comparable product and, as of June 2026, closed the subscription-billing loophole for `-p`/Agent SDK usage. **Mitigation:** Skynet drives CLIs interactively through VSCode's integrated terminal (pty), not headless/SDK — matching how surviving competitors (Claude Squad, Maestro, Crystal) operate. This reduces the risk materially but doesn't eliminate it (see Risks → Legal/ToS).
2. **The niche is already occupied.** Several funded/starred open-source tools already orchestrate Claude Code + Codex (+ others) in parallel from a git-worktree-per-agent model; Microsoft has shipped native multi-agent orchestration inside VS Code itself.

Neither problem is fatal to building *something* here, but both should reshape the bet before scaffolding begins. See "Recommendation" at the end.

## Similar / Competing Products

| Name | What it does | vs. Skynet | Maturity |
|---|---|---|---|
| **AgentsRoom** | Desktop app orchestrating Claude Code, Codex CLI, Antigravity CLI + others; 14 predefined agent roles; first-class multi-Claude-account support | Closest match on providers + roles + multi-account. Standalone app, not VSCode; BYOK not subscription-first | Early-stage |
| **Maestro (RunMaestro)** | OSS (AGPL) app orchestrating unlimited Claude Code/Codex/Copilot-CLI/OpenCode instances; explicit multi-account-per-provider via config dirs | Directly overlaps differentiator #2 (multi-account). No Scrum framing, not VSCode | 3,080 ⭐ |
| **Vibe Kanban** | Kanban board orchestrating Claude Code, Codex, Gemini CLI agents in parallel | Largest player in the space; no roles/Scrum, not a VSCode extension (web dashboard). Parent company shut down its hosted service in early 2026 — signal the category struggles commercially | 27,239 ⭐ |
| **Claude Squad** | tmux/terminal manager for multiple CLI agent sessions in parallel worktrees | Pure session manager, no roles or IDE UI | 7,991 ⭐ |
| **Crystal**, **ai-maestro**, **Conductor**, **workmux** | Various desktop/dashboard tools for parallel CLI-agent sessions with worktree isolation | Worktree-per-agent + diff review is now table stakes across this category, not a differentiator | Niche-to-moderate |
| **VS Code native "Agents Window"** (Microsoft, shipped v1.109, Feb 2026) | Built-in multi-engine agent harness inside VS Code running Claude, Codex/Copilot CLI, and cloud agents side by side | **Platform risk.** Microsoft is building generic multi-provider orchestration natively into the exact IDE surface Skynet targets, for free | Shipping in stable VS Code |
| **GitHub Agent HQ** (public preview, Feb 2026) | "Mission Control" for running Copilot/Claude/Codex side by side, PR-centric, cloud/async | Free, Microsoft-backed, multi-provider — the biggest structural incumbent threat | Public preview, high distribution |
| **CrewAI**, **MetaGPT**, **ChatDev** | Role-based multi-agent frameworks (PM/architect/engineer/QA); MetaGPT and ChatDev use SDLC/team metaphors close to Scrum | Validate the "team of agent roles" metaphor generally, but are API-key libraries, not CLI-subscription wrappers or IDE products | 33K–55K ⭐ each |
| **Claude Switch, aimux, claude-code-profiles** | Small tools/scripts for juggling multiple Claude Code accounts | Validates multi-account pain is real and already being solved piecemeal | Small, DIY-tier |

**Read:** The exact combination Skynet proposes (VSCode extension + subscription-auth-first + multi-account-per-provider + Codex→Antigravity→Claude ordering + Scrum framing) has no exact incumbent, but the gap is narrow and closing fast. AgentsRoom and Maestro already solve the multi-account + multi-provider orchestration piece; Microsoft and GitHub are absorbing the "multiple agents in one IDE" piece natively and for free. A fast follow from any of these erases most of the differentiation.

## Market Potential

- AI coding assistant market: **$9.35B–$12.8B (2026)**, 22–26% CAGR through 2031–2033.
- Adoption is real and growing: Copilot ~20M all-time users / 4.7M paid; Claude Code run-rate revenue >$2.5B (Feb 2026, more than doubled since Jan 1); Codex CLI 5M+ weekly users (up from 600K at start of 2026); 84% of developers use or plan to use AI coding tools (Stack Overflow 2025).
- VSCode is the dominant IDE (75.9% usage), but AI-native competitors are already carving out real share (Cursor 18%, Claude Code 10%, Windsurf 5%) — distribution is fragmenting away from pure VSCode-extension plays.
- Multi-agent demand is directionally real but unproven at the "team orchestration" level: only 31% of developers use AI agents at all today (14.1% daily); no survey isolates specific demand for multi-agent orchestration. Frameworks like CrewAI show huge growth (45K⭐, +1,014% in two years) but that's developer/framework adoption, not evidence of end-user product demand.
- **Cost pain and "subscription arbitrage" are well-documented and real**: Max plan break-even is ~$3.33–6.67/day of API-equivalent usage; tools like `ccusage` (4.8K⭐) exist specifically to track API-equivalent savings. VentureBeat has named "subscription arbitrage" as a phenomenon — $20/mo Pro users routing agents to do hundreds of dollars of work.

**Assessment:** the underlying market is large and growing, and the cost pain that motivates Skynet's core mechanic is real and documented. But the specific wedge — a third-party VSCode extension built around subscription-auth arbitrage — is narrow, contested, and (per the risk findings below) actively being closed off by the providers themselves rather than opening up.

## Differentiation Opportunities (ranked, strongest first)

1. **Cost-aware task routing across accounts/providers by remaining quota.** No found competitor routes work based on *live remaining subscription quota* across multiple accounts/providers — existing multi-account tools are single-provider wrappers, and GitHub Agent HQ lets you pick a provider but doesn't arbitrage your own quota. Most defensible if it survives the ToS risk below.
2. **VSCode-native multi-account management, polished.** The pain (juggling multiple Claude/ChatGPT logins for more effective throughput) is validated and already worked around via shell aliases and DIY scripts/gists — nobody has made it a first-class, per-agent-role IDE setting. Execution/polish win, not a novel idea.
3. **Provider-agnostic orchestration layer.** Demand is proven at the platform level (GitHub Agent HQ, VS Code Agents Window already do this), which de-risks the bet on desirability but means competing directly with free, Microsoft/GitHub-backed incumbents on the same surface.
4. **Scrum/Agile role framing as IDE UX.** The metaphor itself isn't novel (MetaGPT since 2023, "AgentScrum" branding exists, Scrum.org publishes on AI-augmented Scrum) — but nobody has shipped a *polished, IDE-native* embodiment with a real kanban board, standup summaries, and PR-linked sprint review. Current versions are CLI frameworks or generic PM-tool AI features.
5. **Human "Scrum Master" oversight with ceremony-driven control gates.** Underserved: dashboards show who's working on what, but none implement ceremonies (retro triggers replanning, PO-agent approval gates before a dev-agent's PR proceeds) as functional control primitives. A workflow/UX bet, not a technical moat.

## Risks

### Legal / ToS — **HIGH, and current, not hypothetical**

This is the load-bearing risk for the whole idea. Anthropic has already taken enforcement action against a directly comparable product:

- **OpenClaw**, a third-party harness letting users drive Claude via subscription OAuth instead of API keys, was targeted starting Feb 20, 2026 (ToS amendment prohibiting subscription OAuth tokens in third-party tools) with enforcement from Apr 4, 2026.
- Anthropic partially reversed the blanket ban after backlash, but as of **June 15, 2026**, headless/programmatic usage (`claude -p`, Agent SDK — exactly what any orchestration extension must use) has been carved out of the Pro/Max/Team/Enterprise subscription pool entirely and billed separately at metered API rates. **This closes the specific loophole Skynet's #1 differentiator depends on**, weeks before this discovery doc was written.
- Anthropic's own docs: *"Anthropic does not permit third-party developers to offer Claude.ai login or to route requests through Free, Pro, or Max plan credentials on behalf of their users... Anthropic reserves the right to enforce these restrictions and may do so without prior notice."*
- Multi-account usage specifically: Anthropic's Usage Policy bans circumventing bans/limits via multiple coordinated accounts. Routing orchestrated load across several logins to spread usage past per-account caps is functionally the pattern this policy names, even where each account is legitimately the same person's.
- OpenAI is comparatively more permissive — Codex CLI's `exec` mode is officially built for scripted automation, and Plus/Pro plans include Codex — but OpenAI engineers have publicly declined to confirm ToS-compliance for a wrapped/forked distributed product built on ChatGPT OAuth. Multi-account rotation is an open, unshipped feature request, tolerated but not sanctioned.
- Google: multiple credible reports of mass silent bans hitting third-party CLI users of Gemini CLI/Antigravity on paid tiers (Apr–Jun 2026), later partially reversed. Antigravity's API is explicitly restricted to "official workflows" and states it "cannot be used with other Agents" — a direct textual bar on Skynet's orchestration model for that leg.

**This is not a theoretical risk to caveat and move past — it materially undermines the product's stated cost-saving thesis for at least the Anthropic leg, as of the month before this doc was written.**

**Mitigation decided (2026-07-02): drive CLIs interactively via VSCode's integrated terminal (pty), not headless/`-p`/Agent SDK.** Skynet will send input and read output through a real terminal session, simulating the same interaction a human typing in the CLI would produce, rather than calling the documented non-interactive/SDK surface. This is materially different from the OpenClaw/headless pattern the June 2026 policy change targeted, and matches how the surviving competitors (Claude Squad, Maestro, Crystal — all tmux/pty-based) operate; none of these have been targeted by the enforcement action that hit OpenClaw. This reduces but does not eliminate the risk: the Usage Policy's "route requests through Pro/Max credentials on behalf of users" language targets the substance of automated subscription usage, not just the `-p`/SDK flag, so a future enforcement pass could target concurrency/session patterns instead of the API surface. Design implication: keep concurrent same-account session count and request cadence within what a plausible power user would produce by hand, and treat this as an ongoing risk to monitor, not a solved problem.

### Technical — Moderate-High

CLI tools have unstable non-interactive interfaces: Claude Code's headless flag/SDK naming changed under the product; Google discontinued Gemini CLI entirely (Jun 18, 2026) in favor of a new closed-source binary, breaking any integration built against it. None of these tools publish a versioned-API stability contract; orchestrating several concurrently multiplies surface for OAuth session collisions and parsing breakage across releases.

### Adoption — Moderate

The OpenClaw precedent is recent and widely covered (TechCrunch, The Register, VentureBeat) — the technically sophisticated early-adopter audience most likely to try Skynet first is also the audience most likely to already know about it and be risk-averse about their personal paid account. VSCode Marketplace terms don't inherently bar wrapping third-party CLIs; the risk is provider-side, not marketplace-side.

## Recommendation

The research doesn't kill the idea, but it does require an architecture decision before any code is written, and that decision has now been made:

- **Drive CLI agents interactively through VSCode's own terminal (pty), never headless/`-p`/Agent SDK.** This is the load-bearing mitigation for the Legal/ToS risk (decided 2026-07-02, see Risks → Legal/ToS). It matches how the surviving competitors in this space operate and keeps Skynet's traffic pattern indistinguishable from a human power-user typing in several terminals, rather than a documented programmatic surface a provider can flag and meter separately. It is a risk reduction, not an elimination — session/concurrency patterns should stay plausible for a human, and this should be revisited if enforcement patterns shift.
- **Still don't lead marketing/positioning with "avoid metered billing."** Frame subscription auth as "use your existing login, no separate API key to manage" (convenience/UX) rather than a savings claim — the interactive mitigation reduces detection/enforcement risk, it doesn't make circumventing per-account usage caps via multiple accounts sanctioned behavior.
- **The differentiation that survives scrutiny is #1 and #2 (quota-aware routing, polished multi-account UX) plus #5 (ceremony-driven oversight) — not the Scrum-team framing alone**, which is validated as *resonant* but not novel, and not "provider-agnostic orchestration" alone, which free Microsoft/GitHub tooling already ships.

Proceeding to Setup with this architecture decision (interactive pty-driven orchestration) as a given.
