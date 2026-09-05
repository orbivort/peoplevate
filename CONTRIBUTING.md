# Contributing to Peoplevate

Thanks for taking the time to contribute! Please read this document before opening issues or pull requests.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [How to Contribute](#how-to-contribute)
- [Development Setup](#development-setup)
- [Project Conventions](#project-conventions)
- [Testing](#testing)
- [Commit Conventions](#commit-conventions)
- [Release Process](#release-process)

## Code of Conduct

This project adheres to a [Code of Conduct](./CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.

## How to Contribute

### Reporting Bugs

- Search existing [issues](https://github.com/peoplevate/peoplevate/issues) before opening a new one.
- Use the provided [issue templates](.github/ISSUE_TEMPLATE/).
- Provide a clear, minimal reproduction, expected vs. actual behavior, and environment details (OS, Node/pnpm versions).

### Requesting Features

- Open an issue describing the problem you want to solve, the proposed behavior, and why it matters.

### Submitting Changes

1. Fork the repository.
2. Create a feature branch: `git checkout -b feat/my-feature`.
3. Make your changes following the [project conventions](#project-conventions).
4. Ensure all checks pass: `pnpm ci`.
5. Open a pull request targeting `main`.

## Development Setup

Prerequisites: Node.js `^24`, pnpm `^11`, PostgreSQL.

```bash
pnpm install

# Backend: copy .env.example -> .env (and .env.test) and fill in
#   DATABASE_URL, JWT_SECRET (>= 32), FIELD_ENCRYPTION_KEY (>= 32)
# Frontend: copy .env.example -> .env.local

pnpm db:generate
pnpm db:migrate
pnpm dev
```

## Project Conventions

- **Monorepo:** pnpm workspaces. Use `pnpm --filter <package>` for package-scoped commands.
- **TypeScript strict + ESM.** Avoid `any`.
- **Backend ESM:** relative imports must include the `.js` extension.
- **Do not edit `src/generated/prisma`** — change `prisma/schema.prisma` and run `pnpm db:generate`.
- **Formatting:** Prettier (see `.prettierrc`). Run `pnpm format:write` before committing.
- **Linting:** shared flat config. Unused variables are errors unless prefixed with `_`.
- **Naming:** `*Service`, `*Routes`; co-located `*.test.ts(x)`.
- **Database:** snake_case columns, camelCase relations, `_at` suffix on `DateTime`, soft deletes via `deleted_at`, UUID primary keys.
- **API:** base path `/api/<resource>`, health check at `/health`.

## Testing

Run tests before considering work done.

```bash
pnpm test                 # frontend + backend unit tests
pnpm test:coverage        # with coverage
pnpm test:integration     # backend integration tests (needs local Postgres)
pnpm test:typecheck       # type-check test files
```

- Keep tests co-located with the code they cover.
- Update or add tests for any behavior you change or add.

## Pull Request Guidelines

- Keep PRs focused on a single concern. Prefer small, reviewable changes.
- Ensure the PR description clearly explains the what and why, and references related issues.
- Make sure `pnpm ci` passes (typecheck, test typecheck, lint, CSS lint, format check, coverage).
- Keep your branch up to date with `main`.

## Commit Conventions

We follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat: ...` — a new feature
- `fix: ...` — a bug fix
- `chore: ...` — maintenance/tooling
- `refactor: ...` — refactoring
- `test: ...` — test-only changes
- `docs: ...` — documentation changes
- `perf: ...` — performance improvements

Example: `feat(attendance): add clock-in/clock-out validation`

Commit messages drive releases: the release tooling derives the next SemVer
bump and the changelog from them. Mark breaking changes with `!` after the
type (e.g. `feat(api)!:`) or a `BREAKING CHANGE:` footer in the commit body.

## Release Process

Releases are automated across three GitHub Actions workflows; maintainers
review a release pull request before anything is tagged or published.

### Phase 1 — Prepare (`Prepare Release` workflow)

Run **Prepare Release** (`release-prepare.yml`) via _Actions → Prepare Release
→ Run workflow_. Inputs:

- **bump** — `auto` (default) derives the bump from conventional commits since
  the last tag: breaking → `major`, `feat` → `minor`, `fix`/`perf` → `patch`.
  You can also force `major`, `minor`, or `patch`.
- **version** — an explicit version (e.g. `1.2.3`) that overrides **bump**.

The workflow:

1. Computes the next version and fails early if the tag already exists.
2. Bumps the `version` field in the release manifests — the root
   `package.json`, `packages/backend/package.json`, and
   `packages/frontend/package.json` — kept in lockstep with the git tag. The
   other workspace packages (`@peoplevate/e2e`, `@peoplevate/eslint-config`,
   `@peoplevate/vitest-config`) are versionless internal tooling.
3. Prepends a [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) section
   generated from the conventional commits to `CHANGELOG.md`.
4. Pushes a `release/vX.Y.Z` branch and opens a **release pull request**
   titled `chore(release): vX.Y.Z` containing the changelog section.

### Phase 2 — Review

Review the release PR like any other: check the version bump and the
changelog section, and make sure `pnpm ci` passes. Note that CI may not run
automatically on the PR because the branch is pushed with the default
`GITHUB_TOKEN` (GitHub suppresses workflow runs it triggers itself); run the
checks locally or approve workflows from the Actions tab if prompted.

### Phase 3 — Publish (`Publish Release` + `Release` workflows)

Merging the release PR triggers **Publish Release** (`release-publish.yml`),
which verifies `package.json` and `CHANGELOG.md` match the release version,
tags `main` with an annotated `vX.Y.Z` tag, and dispatches the existing
**Release** (`release.yml`) workflow for the tag. That workflow then builds
and publishes the backend/frontend Docker images to GHCR and creates the
GitHub Release with the reviewed changelog section as its body.

### Manual fallback

Manually pushing a tag (`git tag vX.Y.Z && git push origin vX.Y.Z`) still
triggers the Release workflow. In that case the GitHub Release notes are
generated from conventional commits instead of the changelog file, so prefer
the release-PR flow whenever possible.

## Questions

If you're unsure about anything, open an issue or ask in your pull request.
