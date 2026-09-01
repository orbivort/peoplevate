#!/usr/bin/env node
/**
 * Extract the changelog section for a version from CHANGELOG.md and print it
 * to stdout. Used by the Release workflow so the GitHub Release body is the
 * exact section that was reviewed in the release pull request (single source
 * of truth).
 *
 * CLI usage:
 *   node extract-changelog.mjs <version>
 *
 * Exits with code 1 (and prints nothing to stdout) when CHANGELOG.md has no
 * section for the version - callers use this to fall back to generating the
 * notes from conventional commits (e.g. manually pushed tags).
 */
import { readFileSync } from 'node:fs';

const version = process.argv[2];
if (!version) {
  console.error('Usage: node extract-changelog.mjs <version>');
  process.exit(1);
}

const lines = readFileSync('CHANGELOG.md', 'utf8').split('\n');
const start = lines.findIndex((line) => line.startsWith(`## [${version}]`));
if (start === -1) {
  console.error(`CHANGELOG.md has no section for ${version}.`);
  process.exit(1);
}

const section = [];
for (let i = start + 1; i < lines.length; i += 1) {
  const line = lines[i];
  // Stop at the next version entry or at the horizontal rule that separates
  // the entries from the link reference footer.
  if (line.startsWith('## [') || /^---\s*$/.test(line)) break;
  section.push(line);
}

// Trim trailing blank lines, then print the section starting from its heading,
// keeping exactly one blank line between the heading and the body.
while (section.length > 0 && section.at(-1).trim() === '') section.pop();
process.stdout.write(`${lines[start]}\n${section.join('\n').replace(/^\n+/, '\n')}\n`);
