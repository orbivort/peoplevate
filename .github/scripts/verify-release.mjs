#!/usr/bin/env node
/**
 * Verify that the repository metadata is consistent with a release version
 * before the tag is created:
 *
 *   1. the root package.json "version" field matches the release version, and
 *   2. CHANGELOG.md contains a section for it.
 *
 * CLI usage:
 *   node verify-release.mjs <version>
 *
 * Used by the Publish Release workflow as a final guard so a tag can never be
 * cut from a merge whose version bump or changelog entry was lost.
 */
import { readFileSync } from 'node:fs';

/** Read a UTF-8 file, tolerating a leading BOM (common on Windows editors). */
function readFile(path, encoding) {
  return readFileSync(path, encoding).replace(/^\uFEFF/, '');
}

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+(?:[-+].+)?$/.test(version)) {
  console.error(`Invalid or missing version '${version ?? ''}'. Expected semver such as 1.2.3.`);
  process.exit(1);
}

const pkgVersion = JSON.parse(readFile('package.json', 'utf8')).version;
if (pkgVersion !== version) {
  console.error(
    `package.json version is '${pkgVersion}' but the release version is '${version}'. ` +
      'The release pull request was probably merged after main moved ahead. ' +
      'Close this PR and run the Prepare Release workflow again.',
  );
  process.exit(1);
}

const changelog = readFileSync('CHANGELOG.md', 'utf8');
if (!changelog.includes(`## [${version}]`)) {
  console.error(`CHANGELOG.md has no section for ${version}. The changelog update was lost.`);
  process.exit(1);
}

console.log(`Release metadata verified for ${version}.`);
