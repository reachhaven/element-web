<!--
SPDX-FileCopyrightText: 2026 vDL Digital Ventures

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only
-->

# This fork of Element Web

This repository forks `element-hq/element-web` and builds a white-label web image from it. No brand lives here: a deployment mounts its brand at `/brand` and sets the rest through the environment (`README.md`, "Deployment contract"). Upstream's instructions stay in force: `AGENTS.md`, `CONTRIBUTING.md`, `code_style.md`.

## Branches

Upstream's `develop` comes into the fork every day, every change the fork makes is a pull request against the fork, and `staging/web` merges them all and is what gets built and deployed. `README.md`, "Branches", explains this in full, with the settings it needs.

- `develop` mirrors upstream's `develop`: it only moves forward to upstream's commit (fast-forward) and nobody commits to it. The `Sync upstream` workflow pulls it every day.
- `config/web-image` holds everything fork-only and generic: `deploy/web/`, `scripts/rebuild-staging.sh`, the `Web image`, `White label` and `Sync upstream` workflows, the guards on upstream's workflows, `REUSE.toml`, `LICENSES/`, this file and the fork's README sections. Long-lived and never upstreamed. It has to be the repository's default branch: GitHub runs the `Sync upstream` schedule only from there.
- `feat/<kebab-subject>` and `fix/<kebab-subject>`: one change each, branched from `develop`, exactly one commit in Conventional Commits form with a scope naming the part (`feat(composer): …`), made with `git commit -s -S`, no AI attribution of any kind. Each has a pull request against the fork's `develop` and is reviewed there; review changes are amended into the one commit and pushed with `git push --force-with-lease` for as long as the pull request is open. Write them to upstream's bar (`CONTRIBUTING.md`, `code_style.md`, tests), so they can go upstream as they are.
- Fork-only branches are allowed for what upstream would never take; their pull request carries the label `fork-only`. One that builds on `config/web-image` starts from it and its pull request targets it, as `feat/web-e2e` does. When `config/web-image` is rewritten, move such a branch onto it with `git rebase --onto origin/config/web-image HEAD~1`.
- `staging/web` is rebuilt, never developed on: `develop`, then `config/web-image`, then every `feat/*` and `fix/*` branch with an open, non-draft pull request against the fork, in name order, each joined by a merge commit `chore(staging): merge <branch>`. `scripts/rebuild-staging.sh` rebuilds it in a clone with signed merge commits; the `Sync upstream` workflow rebuilds it every day with the same script, unsigned, and pushes it when it changed.
- The image is built from `staging/web`. Every image build tags its commit `build/<yyyymmdd>-<12-character commit>` before it pushes; these tags are the source of the published images and are never deleted.

Agents never push and never open pull requests; the owner does both.

## Worktrees

One sibling checkout per branch: `git -C <clone> worktree add ../element-web-<subject> -b <branch> develop` (`config/web-image` instead of `develop` for a fork-only branch built on it). Never develop two branches in one checkout. Build images from a plain clone, with the commit checked out detached at its build tag (`README.md`, "Building"): upstream's `apps/web/Dockerfile` bind-mounts `.git`, which is a file in a worktree, and names the build after that tag.

## White-label guard

`deploy/web/check-white-label.sh` compares the tree with the commit where the fork leaves upstream (the merge base with `upstream/develop`; committed, uncommitted and untracked changes count). It fails when a path or a line of text the fork adds matches one of the patterns in `WHITE_LABEL_PATTERNS`, outside SPDX copyright lines, when an app icon or logo differs from upstream's, or when the fork adds a raster image outside test and screenshot directories. The patterns are the brand words, host names and colours (in every notation code uses) to keep out; they never enter the tree. CI reads them from the `WHITE_LABEL_PATTERNS` secret of the repository or organisation, which the logs mask, and fails while it is unset. The `White label` workflow runs the guard and `reuse lint-file` on the fork's own files for pushes to `config/web-image` and for pull requests that carry it; the `Web image` workflow runs it first, so a red guard means no image.

## Upstream's workflows

On `config/web-image`, every upstream job that publishes, releases, deploys, notifies or acts with Element's credentials runs only in `element-hq/element-web` (`if: github.repository == 'element-hq/element-web'`). The guards act only where GitHub reads this branch's copy of a workflow: on `config/web-image`, `staging/web` and their tags, and, with `config/web-image` as the default branch, for the scheduled, issue and `workflow_run` events GitHub takes from the default branch. Pushes to `develop`, which the `Sync upstream` workflow makes every day with a token whose pushes start workflows, and pull requests into it use upstream's unguarded copy: keep upstream's workflows that publish, deploy or notify on those events disabled in the fork's Actions settings. Workflows upstream adds later reach `staging/web` with the next rebuild, and `config/web-image` when it is rebased, without a guard: guard the new ones that publish, deploy or notify on `config/web-image`.

## Pull requests

Open one against the fork for every `feat/*` and `fix/*` branch: `gh pr create --repo <owner>/element-web --base develop --head <branch>` (`--base config/web-image --label fork-only` for a fork-only branch built on it; create the label once with `gh label create fork-only --repo <owner>/element-web`), titled with the commit's subject. The fork never merges them, since `develop` only mirrors upstream: an open pull request is what puts a change into `staging/web`, and closing it takes the change out at the next rebuild. Pull requests from other repositories never enter `staging/web`.

Contributing upstream is undecided: upstream needs Element's contributor licence agreement (CLA) signed. Until the owner decides, nothing goes upstream. If the answer is yes, the pull request to `element-hq/element-web` is opened from the same branch, with a description written by a person (`CONTRIBUTING.md`), and nothing else changes; once upstream has merged the change, it arrives through `develop` and the fork's pull request is closed.

## Toolchain

Node 22.18 or later (`engines`); pnpm only through `corepack pnpm`. Format with oxfmt (`pnpm lint:fmt:fix`) and lint with oxlint (`pnpm lint:js:fix`), never prettier or eslint. Unit tests run on vitest (`pnpm test:unit` in `apps/web`, or `pnpm -w exec vitest run <path>`). Run `pnpm i18n` after any string change. Run one heavy job at a time: `pnpm install`, a build, a full test run, Playwright or an image build.

## Licences

Upstream is AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial (`LICENSE-*`). The fork's own files carry SPDX headers with `AGPL-3.0-only OR GPL-3.0-only`; `REUSE.toml` covers the ones that cannot, and `LICENSES/` links upstream's licence texts. New files on `feat/*` and `fix/*` take upstream's header, which oxlint enforces, with the fork's owner as holder (`AGENTS.md`, "Code style"). Brand assets never enter this repository.
