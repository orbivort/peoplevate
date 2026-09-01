#!/usr/bin/env node
/**
 * Bump the "version" field in the root package.json and every workspace
 * package (packages/<name>/package.json) to the given release version.
 *
 * The Peoplevate monorepo ships a single coordinated release, so all package
 * versions are kept in lockstep with the git tag (release-please "single
 * package" style).
 *
 * CLI usage:
 *   node bump-version.mjs <version>
 *
 * Version files are re-serialized with the same 2-space indentation the
 * project uses. pnpm-lock.yaml does not need updating: it records dependency
 * edges, not the workspace packages' own versions.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';

/** Read a UTF-8 file, tolerating a leading BOM (common on Windows editors). */
function readFile(path, encoding) {
  return readFileSync(path, encoding).replace(/^\uFEFF/, '');
}

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+(?:[-+].+)?$/.test(version)) {
  console.error(`Invalid or missing version '${version ?? ''}'. Expected semver such as 1.2.3.`);
  process.exit(1);
}

/** Candidate package manifests: the root plus one per workspace package. */
const manifestPaths = ['package.json'];
for (const entry of readdirSync('packages', { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const manifest = `packages/${entry.name}/package.json`;
  try {
    readFileSync(manifest, 'utf8');
    manifestPaths.push(manifest);
  } catch {
    // Workspace folder without a package.json (e.g. generated code) - skip.
  }
}

for (const path of manifestPaths) {
  const pkg = JSON.parse(readFile(path, 'utf8'));
  const previous = pkg.version;
  pkg.version = version;
  writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`);
  console.log(`Bumped ${path}: ${previous} -> ${version}`);
}
