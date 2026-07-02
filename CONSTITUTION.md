# Skynet - Constitution

Canonical source of truth for this project's coding standards. Every
per-tool instruction file (CLAUDE.md, AGENTS.md, GEMINI.md) points here
instead of restating these rules.

## Stack

- Language: TypeScript only.
- Package manager: pnpm only - no `package-lock.json` or `yarn.lock` committed.
- Test runner: vitest for unit tests (`pnpm run test:unit`), `@vscode/test-cli`
  for integration tests inside a real VSCode instance (`pnpm run test:integration`).
- Formatter/linter: Biome only - no ESLint or Prettier.

## Conventions

- Naming: camelCase for variables/functions, PascalCase for
  classes/types/interfaces, kebab-case for filenames.
- Test files: `*.test.ts`, colocated with the source file they test.
- Commits: Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`,
  `refactor:`, `test:`), enforced by a commit-msg git hook running commitlint.

## Architecture

Skynet drives CLI coding agents (Claude Code, Codex CLI, Antigravity CLI)
**interactively through a real terminal/pty**, never via headless flags or
a provider SDK. Do not add provider SDK or API-client dependencies for
agent orchestration - pty/terminal integration only. See
`docs/superpowers/specs/2026-07-02-skynet-discovery.md` (Risks -> Legal/ToS)
for why.
