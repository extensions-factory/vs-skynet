# Skynet Scaffold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a scaffolded, tooling-complete VSCode extension repo for Skynet — compiles, lints, and tests green — with no product features yet.

**Architecture:** Generate the extension skeleton with Microsoft's official `generator-code` Yeoman generator, then layer the project's chosen tooling (pnpm, vitest, Biome, Conventional Commits, GitHub Actions) on top and replace anything the generator defaults to that conflicts with those choices (npm → pnpm, ESLint → Biome).

**Tech Stack:** TypeScript, pnpm, vitest, `@vscode/test-cli`, Biome, commitlint, GitHub Actions.

## Global Constraints

- Language: TypeScript only.
- Package manager: pnpm only — no `package-lock.json` or `yarn.lock` committed.
- Formatter/linter: Biome only — no ESLint or Prettier.
- Test files: `*.test.ts`, colocated with the source file they test.
- Naming: camelCase for variables/functions, PascalCase for classes/types/interfaces, kebab-case for filenames.
- Commits: Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`), enforced by a commit-msg git hook.
- No provider SDK or API-client dependency may be added for agent orchestration — Skynet drives CLI agents interactively through a real terminal/pty, never via headless flags or an SDK (see `docs/superpowers/specs/2026-07-02-skynet-discovery.md`, Risks → Legal/ToS).
- Extension identity: id `skynet`, publisher `riso-tech`, display name `Skynet`.

---

## US-1: Scaffolded, tooling-complete Skynet extension repo

A single vertical slice: running `pnpm install && pnpm run compile && pnpm run lint && pnpm test` all succeed, and the extension launches in VSCode's Extension Development Host, on a repo with no product features — the walking skeleton the discovery/scaffold specs called for.

### Task 1: Generate the extension skeleton and switch to pnpm

**Files:**
- Create: entire generated tree from `generator-code` (`package.json`, `tsconfig.json`, `src/extension.ts`, `src/test/extension.test.ts`, `.vscode/launch.json`, `.vscode-test.mjs`, `.vscodeignore`, `vsc-extension-quickstart.md`, `CHANGELOG.md`, `eslint.config.mjs` or `.eslintrc.json` — exact set depends on the generator version, verified in Step 2)
- Modify: `package.json` (package manager fields), root (add `pnpm-lock.yaml`, remove any npm/yarn lockfile)

**Interfaces:**
- Produces: an `activate(context: vscode.ExtensionContext)` export from `src/extension.ts` — every later task in this plan that touches `src/extension.ts` relies on this exact function name and signature.

- [ ] **Step 1: Run the official VSCode extension generator**

Run:
```bash
npx --package yo --package generator-code -- yo code
```

Answer the interactive prompts with these values (if a prompt's exact wording differs from what's listed — generator versions vary slightly — pick the closest matching option, keeping the same underlying answer):

| Prompt | Answer |
| --- | --- |
| What type of extension do you want to create? | New Extension (TypeScript) |
| What's the name of your extension? | Skynet |
| What's the identifier of your extension? | skynet |
| What's the description of your extension? | AI CLI agents orchestrated as a Scrum team inside VSCode |
| Initialize a git repository? | No (this repo is already initialized) |
| Which bundler to use? | None / unbundled |
| Which package manager to use? | npm (if pnpm isn't offered as an option — converted in Step 3) |
| Publisher name | riso-tech |

- [ ] **Step 2: Verify the generated file tree**

Run: `find . -maxdepth 2 -not -path './.git*' -not -path './docs*'`

Expected: `package.json`, `tsconfig.json`, `src/`, `.vscode/`, and either `eslint.config.mjs` or `.eslintrc.json` are present. Note which ESLint config file exists — needed in Task 4.

- [ ] **Step 3: Convert the project to pnpm**

Run:
```bash
rm -f package-lock.json yarn.lock
pnpm install
```

Expected: `pnpm-lock.yaml` is created; no errors.

- [ ] **Step 4: Update `package.json` identity fields to match Global Constraints**

Open `package.json` and ensure these fields are set exactly:
```json
{
  "name": "skynet",
  "displayName": "Skynet",
  "publisher": "riso-tech",
  "description": "AI CLI agents orchestrated as a Scrum team inside VSCode"
}
```
(Leave `engines`, `main`, `contributes`, and `activationEvents` as generated — they're not covered by this plan.)

- [ ] **Step 5: Confirm the skeleton compiles**

Run: `pnpm run compile`
Expected: exits 0, produces compiled output (typically `out/extension.js`).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: scaffold VSCode extension via generator-code, switch to pnpm"
```

---

### Task 2: Add vitest for unit tests

**Files:**
- Create: `vitest.config.ts`, `src/test-utils/vscode-mock.ts`, `src/extension.test.ts`
- Modify: `package.json` (`scripts`, `devDependencies`)

**Interfaces:**
- Consumes: `activate` from `src/extension.ts` (Task 1).
- Produces: a `vscode` module alias (`src/test-utils/vscode-mock.ts`) that any future vitest unit test importing `vscode` will resolve to — later provider-adapter unit tests reuse this same mock file rather than each writing their own.

Real logic in `src/extension.ts` imports `vscode`, a module that only exists inside the VSCode Extension Host — plain Node (which vitest runs under) can't resolve it. To unit-test `activate` without a real VSCode host, vitest needs a `vscode` alias pointing at a minimal local mock covering just the two APIs the generated `extension.ts` calls: `commands.registerCommand` and `window.showInformationMessage`.

- [ ] **Step 1: Install vitest**

Run: `pnpm add -D vitest`

- [ ] **Step 2: Write the vscode mock**

Create `src/test-utils/vscode-mock.ts`:
```ts
import { vi } from 'vitest';

export const commands = {
  registerCommand: vi.fn(),
};

export const window = {
  showInformationMessage: vi.fn(),
};
```

- [ ] **Step 3: Write vitest config**

Create `vitest.config.ts`:
```ts
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['src/test/**'],
  },
  resolve: {
    alias: {
      vscode: resolve(__dirname, 'src/test-utils/vscode-mock.ts'),
    },
  },
});
```

The `exclude: ['src/test/**']` keeps vitest from picking up the generator's own integration test at `src/test/extension.test.ts` (Task 3), which needs the real `@vscode/test-cli` runner, not vitest.

- [ ] **Step 4: Write the failing test**

Create `src/extension.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import { activate } from './extension';

describe('activate', () => {
  it('registers exactly one command', () => {
    const context = { subscriptions: [] } as unknown as Parameters<typeof activate>[0];

    activate(context);

    expect(vscode.commands.registerCommand).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 5: Add the `test:unit` script**

In `package.json`, add to `"scripts"`:
```json
"test:unit": "vitest run"
```

- [ ] **Step 6: Run the test and verify it passes**

Run: `pnpm run test:unit`
Expected: PASS — 1 test passed. (No separate "verify it fails first" step here: the test target, `activate`, already exists from Task 1, so red-then-green isn't meaningful — the check that matters is that the mock/alias wiring actually lets the import succeed and the assertion run.)

- [ ] **Step 7: Commit**

```bash
git add vitest.config.ts src/test-utils/vscode-mock.ts src/extension.test.ts package.json pnpm-lock.yaml
git commit -m "test: add vitest unit test for extension activate()"
```

---

### Task 3: Verify the generator's integration test suite runs under `@vscode/test-cli`

**Files:**
- Modify: `package.json` (`scripts`, rename generated `test` script)
- Test (verify only, no new file): `src/test/extension.test.ts` (generated in Task 1)

**Interfaces:**
- Consumes: nothing new.
- Produces: a `test:integration` script name — Task 9 (CI) and the walking-skeleton verification (Task 10) both reference this exact script name.

Current `generator-code` versions scaffold `@vscode/test-cli` + `@vscode/test-electron` and a sample integration test at `src/test/extension.test.ts` by default. This task confirms that's true and renames the script for clarity alongside `test:unit` — it does not author a new test.

- [ ] **Step 1: Confirm the generated integration test setup exists**

Run: `test -f .vscode-test.mjs && test -f src/test/extension.test.ts && echo present`
Expected: `present`. If either file is missing, install and configure it manually:
```bash
pnpm add -D @vscode/test-cli @vscode/test-electron
```
then create `.vscode-test.mjs`:
```js
import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
  files: 'out/test/**/*.test.js',
});
```

- [ ] **Step 2: Rename the integration test script**

Open `package.json` and ensure the `"scripts"` block contains exactly (merging with `test:unit` from Task 2, keeping other existing scripts like `compile`/`watch`/`vscode:prepublish` untouched):
```json
"pretest": "pnpm run compile",
"test:integration": "vscode-test",
"test:unit": "vitest run",
"test": "pnpm run test:unit && pnpm run test:integration"
```
(Remove any old plain `"test": "vscode-test"` entry the generator created — it's superseded by the combined script above.)

- [ ] **Step 3: Run the integration suite and verify it passes**

Run: `pnpm run test:integration`
Expected: PASS — the generator's sample test(s) succeed (this launches a real, headless-capable VSCode instance; on a machine with no display it may need `xvfb-run pnpm run test:integration` — note this for Task 9's CI stub).

- [ ] **Step 4: Commit**

```bash
git add package.json .vscode-test.mjs
git commit -m "chore: wire up test:integration and test:unit scripts"
```

---

### Task 4: Replace ESLint with Biome

**Files:**
- Create: `biome.json` (via `biome init`, then edited)
- Delete: whichever ESLint config file Task 1 Step 2 identified (`eslint.config.mjs` or `.eslintrc.json`)
- Modify: `package.json` (`scripts`, `devDependencies`)

**Interfaces:**
- Produces: a `lint` script that Task 9 (CI) and Task 10 (verification) both call.

- [ ] **Step 1: Remove ESLint**

Run: `pnpm remove eslint` (and any `eslint-*`/`@typescript-eslint/*` packages listed under `devDependencies` in `package.json` — remove each with `pnpm remove <name>`)

Delete the ESLint config file identified in Task 1 Step 2:
```bash
rm -f eslint.config.mjs .eslintrc.json
```

- [ ] **Step 2: Install and initialize Biome**

Run:
```bash
pnpm add -D @biomejs/biome
pnpm exec biome init
```
Expected: creates `biome.json` with Biome's own current default schema/version — don't hand-author this file, the generator produces a version-correct config.

- [ ] **Step 3: Exclude build output from Biome**

Open the generated `biome.json`. Add the compiled output directory to whichever exclusion mechanism its schema uses:
- If the file has a `"files": { "ignore": [...] }` key (Biome 1.x schema): add `"out/**"` to that array.
- If the file has a `"files": { "includes": [...] }` key with `!`-prefixed negation globs (Biome 2.x schema): add `"!out/**"` to that array.

- [ ] **Step 4: Replace the lint script**

In `package.json`, update `"scripts"` so `"lint"` reads:
```json
"lint": "biome check .",
"lint:fix": "biome check --write ."
```

- [ ] **Step 5: Run lint and verify it passes**

Run: `pnpm run lint`
Expected: exits 0. If it reports fixable formatting issues in generator-produced files, run `pnpm run lint:fix` once, then re-run `pnpm run lint` to confirm exit 0.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: replace ESLint with Biome"
```

---

### Task 5: Write CONSTITUTION.md

**Files:**
- Create: `CONSTITUTION.md`

**Interfaces:**
- Produces: the canonical standards doc every per-tool file in Task 6 points to.

- [ ] **Step 1: Write the file**

Create `CONSTITUTION.md`:
```markdown
# Skynet — Constitution

Canonical source of truth for this project's coding standards. Every
per-tool instruction file (CLAUDE.md, AGENTS.md, GEMINI.md) points here
instead of restating these rules.

## Stack

- Language: TypeScript only.
- Package manager: pnpm only — no `package-lock.json` or `yarn.lock` committed.
- Test runner: vitest for unit tests (`pnpm run test:unit`), `@vscode/test-cli`
  for integration tests inside a real VSCode instance (`pnpm run test:integration`).
- Formatter/linter: Biome only — no ESLint or Prettier.

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
agent orchestration — pty/terminal integration only. See
`docs/superpowers/specs/2026-07-02-skynet-discovery.md` (Risks → Legal/ToS)
for why.
```

- [ ] **Step 2: Commit**

```bash
git add CONSTITUTION.md
git commit -m "docs: add CONSTITUTION.md as canonical standards source"
```

---

### Task 6: Write per-tool instruction files

**Files:**
- Create: `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`

**Interfaces:**
- Consumes: `CONSTITUTION.md` (Task 5) — each file points there rather than restating content.

- [ ] **Step 1: Write CLAUDE.md**

```markdown
# Skynet

See `CONSTITUTION.md` for this project's coding standards, conventions,
and architecture rules.

Claude Code is also one of Skynet's orchestrated providers (see
`docs/superpowers/specs/`) — when working on provider-adapter code, the
pty-only architecture rule in CONSTITUTION.md is not optional.
```

- [ ] **Step 2: Write AGENTS.md**

```markdown
# Skynet

See `CONSTITUTION.md` for this project's coding standards, conventions,
and architecture rules.

Codex is Skynet's first-priority orchestrated provider (see
`docs/superpowers/specs/2026-07-02-skynet-scaffold-design.md`) — when
working on provider-adapter code, the pty-only architecture rule in
CONSTITUTION.md is not optional.
```

- [ ] **Step 3: Write GEMINI.md**

```markdown
# Skynet

See `CONSTITUTION.md` for this project's coding standards, conventions,
and architecture rules.

Antigravity CLI is Skynet's second-priority orchestrated provider (see
`docs/superpowers/specs/2026-07-02-skynet-scaffold-design.md`) — when
working on provider-adapter code, the pty-only architecture rule in
CONSTITUTION.md is not optional.
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md AGENTS.md GEMINI.md
git commit -m "docs: add per-tool instruction files pointing to CONSTITUTION.md"
```

---

### Task 7: Enforce Conventional Commits with commitlint

**Files:**
- Create: `commitlint.config.js`, `.githooks/commit-msg`
- Modify: `package.json` (`devDependencies`), git config (`core.hooksPath`)

**Interfaces:**
- Produces: nothing consumed by later tasks — this is a repo-local enforcement mechanism, not code.

- [ ] **Step 1: Install commitlint**

Run: `pnpm add -D @commitlint/cli @commitlint/config-conventional`

- [ ] **Step 2: Write the commitlint config**

Create `commitlint.config.js`:
```js
module.exports = {
  extends: ['@commitlint/config-conventional'],
};
```

- [ ] **Step 3: Write a plain git hook (no hook-manager dependency)**

Create `.githooks/commit-msg`:
```sh
#!/bin/sh
pnpm exec commitlint --edit "$1"
```

Run: `chmod +x .githooks/commit-msg`

- [ ] **Step 4: Point git at the hooks directory**

Run: `git config core.hooksPath .githooks`

- [ ] **Step 5: Verify the hook rejects a bad commit message**

Run:
```bash
git add commitlint.config.js .githooks
git commit -m "this is not a conventional commit message"
```
Expected: commit is REJECTED with a commitlint error (e.g. `subject may not be empty` / `type may not be empty`).

- [ ] **Step 6: Commit for real**

```bash
git commit -m "chore: enforce Conventional Commits via commitlint git hook"
```
Expected: commit SUCCEEDS (the message itself is a valid Conventional Commit, proving the hook both rejects bad messages and accepts good ones).

---

### Task 8: Write .gitignore

**Files:**
- Create: `.gitignore`

- [ ] **Step 1: Write the file**

Create `.gitignore`:
```
node_modules/
out/
dist/
*.vsix
.vscode-test/
.claude/
```

- [ ] **Step 2: Verify it covers what's currently untracked but shouldn't be committed**

Run: `git status --porcelain`
Expected: `node_modules/`, `out/`, `.vscode-test/`, and `.claude/` do not appear in the output.

- [ ] **Step 3: Commit**

```bash
git add .gitignore
git commit -m "chore: add .gitignore"
```

---

### Task 9: Write the GitHub Actions CI stub

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `pnpm run lint` (Task 4), `pnpm run test:unit` (Task 2).

- [ ] **Step 1: Write the workflow**

Create `.github/workflows/ci.yml`:
```yaml
name: ci
on: [push, pull_request]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm run lint
      # ponytail: unit tests + lint only; test:integration needs an
      # xvfb-enabled runner step for headless VSCode, add when that's set up
      - run: pnpm run test:unit
```

- [ ] **Step 2: Verify the commands it runs succeed locally**

Run:
```bash
pnpm install --frozen-lockfile
pnpm run lint
pnpm run test:unit
```
Expected: all three exit 0. (Actual CI execution is verified once this repo has a GitHub remote and this workflow runs there — out of scope for this plan.)

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add lint + unit test GitHub Actions workflow"
```

---

### Task 10: Walking-skeleton verification

**Files:** none (verification only).

- [ ] **Step 1: Full clean install and compile**

Run:
```bash
rm -rf node_modules out
pnpm install
pnpm run compile
```
Expected: all exit 0.

- [ ] **Step 2: Lint**

Run: `pnpm run lint`
Expected: exit 0.

- [ ] **Step 3: Unit and integration tests**

Run: `pnpm test`
Expected: exit 0 (`test:unit` then `test:integration` both pass).

- [ ] **Step 4: Launch the Extension Development Host**

Open this repo in VSCode and press F5 (or run `code --extensionDevelopmentPath=$(pwd) --new-window` if driving VSCode headlessly isn't possible in this environment). In the new Extension Development Host window, open the Command Palette and confirm the generated sample command (e.g. "Hello World") is registered and runs, producing the `showInformationMessage` popup.

This step requires an interactive VSCode session — if run inside a non-interactive agent environment, note that this step could not be automated and ask the human partner to confirm it manually before considering the scaffold branch done.

- [ ] **Step 5: Confirm a clean, fully-committed working tree**

Run: `git status --porcelain`
Expected: empty output — nothing uncommitted.
