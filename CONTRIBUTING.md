# Contributing to Peoplevate

Thanks for taking the time to contribute! Please read this document before opening issues or pull requests.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [How to Contribute](#how-to-contribute)
- [Development Setup](#development-setup)
- [Project Conventions](#project-conventions)
- [Testing](#testing)
- [Commit Conventions](#commit-conventions)

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

## Questions

If you're unsure about anything, open an issue or ask in your pull request.
