#!/usr/bin/env node
/**
 * Determine the next release version from conventional commits.
 *
 * Reads the root package.json for the current version, inspects commits since
 * the most recent `v*` tag, and applies the following rules (SemVer):
 *
 *   - any BREAKING CHANGE  -> major
 *   - any feat             -> minor
 *   - any fix/perf         -> patch
 *   - only chores/docs/... -> patch (nothing notable still warrants a bump)
 *
 * CLI usage:
 *   node next-version.mjs --bump <auto|major|minor|patch>
 *
 * Prints ONLY the next version (without the leading "v") on stdout so the
 * output can be captured directly in workflows. Errors go to stderr with a
 * non-zero exit code.
 */
import { readFileSync } from 'node:fs';
import { collectCommits, latestTag } from './changelog.mjs';

const bumpIndex = process.argv.indexOf('--bump');
const bump = bumpIndex !== -1 ? process.argv[bumpIndex + 1] : 'auto';
if (!['auto', 'major', 'minor', 'patch'].includes(bump)) {
  console.error(`Invalid --bump value '${bump}'. Expected auto, major, minor, or patch.`);
  process.exit(1);
}

const previousTag = latestTag();
const commits = collectCommits(previousTag);
if (commits.length === 0) {
  console.error(
    previousTag
      ? `No commits found since ${previousTag}; nothing to release.`
      : 'No commits found in the repository history; nothing to release.',
  );
  process.exit(1);
}

if (bump !== 'auto') {
  process.stdout.write(bumpNext(currentVersion(), bump) + '\n');
  process.exit(0);
}

// Derive the bump from conventional commits. Precedence: breaking > feat > fix.
const subjects = commits.map((commit) => commit.subject);
const hasBreaking = subjects.some(
  (subject) => /^\w+(\([^)]*\))?!:/.test(subject) || /^BREAKING CHANGE:/m.test(subject),
);
const hasMinor = subjects.some((subject) => /^feat(\([^)]*\))?:/.test(subject));
const hasPatch = subjects.some((subject) => /^(fix|perf)(\([^)]*\))?:/.test(subject));

const derived = hasBreaking ? 'major' : hasMinor ? 'minor' : 'patch';
process.stdout.write(bumpNext(currentVersion(), derived) + '\n');

/** Current version from the root package.json (without the leading "v"). */
function currentVersion() {
  const pkg = JSON.parse(readJson('package.json'));
  return String(pkg.version ?? '0.0.0').replace(/^v/, '');
}

/** Read a UTF-8 file, tolerating a leading BOM (common on Windows editors). */
function readJson(path) {
  return readFileSync(path, 'utf8').replace(/^\uFEFF/, '');
}

/**
 * Apply a SemVer bump to a version string.
 * @param {string} version Current version, e.g. "1.2.3" (prerelease suffixes are dropped).
 * @param {'major'|'minor'|'patch'} bump
 */
function bumpNext(version, bump) {
  const [major, minor, patch] = version.split('-')[0].split('.').map(Number);
  if ([major, minor, patch].some(Number.isNaN)) {
    console.error(`Cannot parse current version '${version}' as semver.`);
    process.exit(1);
  }
  if (bump === 'major') return `${major + 1}.0.0`;
  if (bump === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}
