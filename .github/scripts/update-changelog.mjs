#!/usr/bin/env node
/**
 * Prepend a new Keep-a-Changelog section to CHANGELOG.md for the release
 * version, generated from the conventional commits since the previous `v*`
 * tag, and append the tag link definition to the reference footer.
 *
 * CLI usage:
 *   node update-changelog.mjs <version>
 *
 * Idempotency guards: exits successfully without changes if a section for the
 * version already exists; fails if no commits are available (explicit version
 * overrides with an empty history are rejected here as well - use the
 * workflow's "bump" input instead).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { collectCommits, generateSection, latestTag } from './changelog.mjs';

/** Read a UTF-8 file, tolerating a leading BOM (common on Windows editors). */
function readFile(path, encoding) {
  return readFileSync(path, encoding).replace(/^\uFEFF/, '');
}

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+(?:[-+].+)?$/.test(version)) {
  console.error(`Invalid or missing version '${version ?? ''}'. Expected semver such as 1.2.3.`);
  process.exit(1);
}

const CHANGELOG_PATH = 'CHANGELOG.md';
const changelog = readFile(CHANGELOG_PATH, 'utf8');

if (changelog.includes(`## [${version}]`)) {
  console.log(`CHANGELOG.md already contains a section for ${version}. Nothing to do.`);
  process.exit(0);
}

const previousTag = latestTag();
const commits = collectCommits(previousTag);
if (commits.length === 0) {
  console.error(
    previousTag
      ? `No commits found since ${previousTag}; refusing to write an empty changelog section.`
      : 'No commits found in the repository history; refusing to write an empty changelog section.',
  );
  process.exit(1);
}

const section = generateSection(version, new Date().toISOString().slice(0, 10), commits);
const updated = insertSection(changelog, section);

const repoUrl = repositoryUrl();
const link = previousTag
  ? `[${version}]: ${repoUrl}/compare/${previousTag}...v${version}`
  : `[${version}]: ${repoUrl}/releases/tag/v${version}`;
const withLink = `${updated.replace(/\s+$/, '\n')}\n${link}\n`;

writeFileSync(CHANGELOG_PATH, withLink);
console.log(`Added ${version} section to CHANGELOG.md (previous tag: ${previousTag ?? 'none'}).`);

/**
 * Insert the section immediately before the first existing `## [...]` entry
 * (below the file header). Fails if the changelog has no entries to position
 * against, keeping the tool simple and predictable.
 */
function insertSection(changelog, section) {
  const lines = changelog.split('\n');
  const index = lines.findIndex((line) => line.startsWith('## ['));
  if (index === -1) {
    console.error('CHANGELOG.md has no existing version sections; cannot position the new one.');
    process.exit(1);
  }
  lines.splice(index, 0, section);
  return lines.join('\n');
}

/** Repository base URL from the root package.json (trailing ".git" stripped). */
function repositoryUrl() {
  const pkg = JSON.parse(readFile('package.json', 'utf8'));
  return String(pkg.repository?.url ?? '').replace(/\.git$/, '');
}
