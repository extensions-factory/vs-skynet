# Skynet — Scaffold Design

**Date:** 2026-07-02
**Scope:** Tooling and repo scaffolding only. No product features. Informed by [2026-07-02-skynet-discovery.md](2026-07-02-skynet-discovery.md).

## Decisions (from Setup Q&A)

| Area | Decision |
| --- | --- |
| Language | TypeScript (VSCode extension API is TS-native; no alternative considered) |
| Package manager | pnpm |
| Test runner | vitest (unit tests, no VSCode host needed) + `@vscode/test-cli`/mocha (integration tests inside a real VSCode instance) |
| Webview UI framework | Deferred — no dashboard UI scaffolded yet; a future feature spec picks this when the kanban/Scrum-board UI is actually designed |
| Formatter/linter | Biome (single tool, one config, replaces ESLint+Prettier) |
| Commit convention | Conventional Commits (`feat:`, `fix:`, `chore:`, ...) |
| Naming | camelCase for vars/functions, PascalCase for classes/types/interfaces, kebab-case for filenames — standard TS/VSCode-extension convention, not separately debated |
| Test file convention | `*.test.ts` colocated with the source file it tests |
| AI tool instruction files | CLAUDE.md, AGENTS.md, GEMINI.md — each a thin pointer to CONSTITUTION.md |
| Git host / CI | GitHub Actions (`.github/workflows/ci.yml`), lint + test only |

## Architecture note carried from discovery

Skynet drives CLI agents (Claude Code, Codex CLI, Antigravity CLI) **interactively through a real terminal/pty**, not via headless flags or an SDK. This is a risk-reduction decision (see discovery doc, Risks → Legal/ToS) with a direct scaffolding consequence: the extension needs a pty/terminal-integration dependency early (e.g. Node's `node-pty` or VSCode's own `Terminal`/`Pseudoterminal` API), not an HTTP/SDK client. No provider SDK packages should be added at scaffold time — there's nothing to configure yet, and adding them now would misrepresent the chosen architecture.

## Tasks for the plan

These are scaffolding actions only — none are executed by this spec; `writing-plans` turns them into an ordered, reviewable plan.

1. **Run the official VSCode extension generator**: `npx --package yo --package generator-code -- yo code` (Microsoft's official Yeoman generator for VSCode extensions), selecting the TypeScript extension template. This produces the base `package.json`, `extension.ts` entry point, `tsconfig.json`, and `.vscode/launch.json` for F5 debugging.
2. **Switch the generated project to pnpm**: replace any `package-lock.json`/npm references with `pnpm-lock.yaml`, confirm `pnpm install` and `pnpm run compile` work.
3. **Add vitest** for unit tests (`pnpm add -D vitest`), plus a `vitest.config.ts` scoped to non-VSCode-host logic.
4. **Wire up `@vscode/test-cli` + mocha** for integration tests that need a real VSCode instance (already partially scaffolded by the generator — confirm `pnpm test` runs it).
5. **Add and configure Biome** (`pnpm add -D @biomejs/biome`, `biome.json`) with lint + format rules matching the Decisions table (naming conventions are enforceable only where Biome supports it; document the rest in CONSTITUTION.md as convention, not lint-enforced).
6. **Write `CONSTITUTION.md`** at repo root: the single canonical source of truth for the Decisions table above (language/tooling choices, naming conventions, commit convention, test-file convention). Every other config or instruction file points back to this document instead of restating it.
7. **Write thin per-tool instruction files** — `CLAUDE.md`, `AGENTS.md`, `GEMINI.md` — each just a pointer ("See `CONSTITUTION.md` for this project's coding standards") plus any genuinely tool-specific config (e.g. Claude Code permissions, if any are needed).
8. **Add `commitlint` + Conventional Commits config** (`pnpm add -D @commitlint/cli @commitlint/config-conventional`, a `commitlint.config.js`, and a `commit-msg` git hook via a lightweight hook manager or a plain `.git/hooks` script — no hook framework unless one is already pulled in by the generator).
9. **Write `.gitignore`** covering `node_modules/`, `out/`/`dist/` (compiled extension output), `.vscode-test/`, and `.claude/` (harness-local state already present as an untracked dir in this repo).
10. **Write the GitHub Actions CI stub** at `.github/workflows/ci.yml`: checkout → `pnpm install` → `pnpm run lint` → `pnpm test`.
11. **Walking-skeleton verification**: run `pnpm run compile`, `pnpm run lint`, `pnpm test`, and launch the extension once via VSCode's Extension Development Host (F5) to confirm the generated "Hello World" command activates. Confirm all green before considering the scaffold branch done.

## Explicitly out of scope for this spec

- Any provider adapter (Claude Code/Codex/Antigravity pty integration) — first real feature, designed later via `brainstorming`.
- The Scrum-board/kanban webview UI and its framework choice.
- Multi-account configuration UX.
- A product roadmap — this is a new repo with no roadmap yet; skipped per project-kickoff instructions.

## Self-review

- **Placeholders:** none left — all Decisions entries and tasks are concrete.
- **Internal consistency:** pty-first architecture (from discovery) is reflected in task 1's tooling note (no SDK deps at scaffold time); test runner and lint choices match the Setup Q&A answers.
- **Scope:** scoped to tooling only, no feature work — fits the "no roadmap entry" carve-out.
- **Ambiguity:** "walking-skeleton verification" (task 11) is made concrete with exact commands so the plan doesn't have to interpret it.
