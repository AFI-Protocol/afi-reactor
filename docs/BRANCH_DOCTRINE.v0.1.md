# Branch Doctrine v0.1 (afi-reactor)

AFI Reactor is AFI Protocol's scored-signal evaluation runtime. Careless branching here can break scoring determinism, evidence provenance, and downstream repos. These rules exist for both droids and humans to keep the runtime predictable and reproducible.

## Branch Roles

### `main`

- Single source of truth for afi-reactor.
- Only branch that droids are allowed to branch from and open PRs into.
- Must remain fast-forward-only (no history rewrites).

### `afi-reactor-freeze-2025-11-16`

- Read-only freeze snapshot for historical reference.
- **NEVER** change this branch: no commits, no merges, no rebases.
- Droids must not create branches from it or target it in PRs.

### `migration/*`

- Long-lived, human-only branches used for repo restructuring or large migrations.
- Droids must not:
  - Branch from `migration/*`.
  - Open PRs into `migration/*`.
  - Force-push or rewrite history on `migration/*`.
- Treat these as “do not touch” unless explicitly instructed by a human maintainer.

### `feature/*`

- Short-lived branches for focused work.
- All droid work MUST happen on `feature/*` branches derived from `origin/main`.
- Name pattern: `feature/<short-task-name>`, e.g. `feature/add-replay-node`.

## Droid Rules (MUST)

Droids operating in afi-reactor MUST:

1. **Branch only from `origin/main`.**
   - Never branch from `migration/*` or `*-freeze-*` branches.
   - Before starting work, ensure:
     - `git checkout main`
     - `git pull origin main`
     - `git checkout -b feature/<short-task-name>`

2. **Open PRs only into `main`.**
   - No direct pushes to `main`.
   - No PRs targeting `migration/*` or `*-freeze-*`.
   - Every change must flow: `feature/*` → PR → `main`.

3. **Keep branches small and focused.**
   - Prefer narrow, single-purpose patches that are easy to review and roll back.
   - Avoid mixing pipeline/composition changes, scoring changes, and docs changes in one branch unless explicitly requested.

4. **Respect reproducibility.**
   - Changes that affect pipeline composition, scoring, or the evidence boundary MUST be clearly documented in the PR description and reflected in `AGENTS.md` and the relevant `docs/`.
   - Do not introduce non-deterministic behavior into scoring or enrichment paths without an explicit spec.

5. **Never modify branch protection or repo settings.**
   - Droids must not alter:
     - Branch protection rules.
     - Required checks.
     - GitHub Actions definitions that gate merges, unless a task explicitly asks for it.

## Human-Only Operations

The following actions are reserved for humans:

- Creating or updating any `*-freeze-*` branch.
- Force-pushes and history rewrites on any branch.
- Tagging releases and managing release branches.
- Deleting remote branches.
- Large-scale merges or rebases of `migration/*` branches.
- Modifying GitHub branch protection and required checks.

## Safety Notes for AFI Reactor

- afi-reactor is the scored-signal evaluation runtime; branch mistakes here can break the whole pipeline.
- Droids should prefer small, focused `feature/*` branches with minimal diffs.
- When in doubt, open an issue or draft PR and ask instead of inventing new branching patterns.
- Keep reproducibility in mind: predictable branching keeps scoring and evidence deterministic and auditable.

