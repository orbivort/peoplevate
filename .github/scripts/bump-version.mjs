#!/usr/bin/env node
/**
 * Bump the "version" field in the release manifests to the given version: the
 * root package.json plus the backend and frontend application packages.
 *
 * The Peoplevate monorepo ships as a single coordinated release, so these
 * three manifests are kept in lockstep with the git tag (release-please
 * "single package" style). The remaining workspace packages (@peoplevate/e2e
 * and the shared config packages) are versionless internal tooling.
 *
 * CLI usage:
 *   node bump-version.mjs <version>
 *
 * Version files are re-serialized with the same 2-space indentation the
 * project uses. pnpm-lock.yaml does not need updating: it records dependency
 * edges, not the workspace packages' own versions.
 */
import { readFileSync, writeFileSync } from 'node:fs';

/** Read a UTF-8 file, tolerating a leading BOM (common on Windows editors). */
function readFile(path, encoding) {
  return readFileSync(path, encoding).replace(/^\uFEFF/, '');
}

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+(?:[-+].+)?$/.test(version)) {
  console.error(`Invalid or missing version '${version ?? ''}'. Expected semver such as 1.2.3.`);
  process.exit(1);
}

/**
 * Manifests that carry the release version. The internal packages
 * (@peoplevate/e2e, @peoplevate/eslint-config, @peoplevate/vitest-config) are
 * intentionally versionless, so this list must be updated only if a package
 * becomes part of the released artifact set.
 */
const manifestPaths = [
  'package.json',
  'packages/backend/package.json',
  'packages/frontend/package.json',
];

for (const path of manifestPaths) {
  const pkg = JSON.parse(readFile(path, 'utf8'));
  const previous = pkg.version;
  pkg.version = version;
  writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`);
  console.log(`Bumped ${path}: ${previous} -> ${version}`);
}
