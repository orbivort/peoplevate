#!/usr/bin/env node
/**
 * Update CHANGELOG.md for the release version.
 *
 * The section for the new version is produced by one of three mutually
 * exclusive branches, in priority order:
 *
 *   1. `## [Unreleased]` is present -> that section is converted in place: its
 *      heading is renamed to `## [<version>] - <date>` and its body is preserved
 *      verbatim. The commit-type mapping below is NOT applied in this branch.
 *   2. No `[Unreleased]` and at least one commit since the previous tag maps to
 *      a section via TYPE_TO_SECTION (feat -> Added, fix -> Fixed,
 *      refactor/perf -> Changed) -> a section is generated from those commits.
 *   3. Otherwise (no `[Unreleased]` and no mapped commits) -> the release section
 *      is added with a blank body.
 *
 * In every branch the `[<version>]:` compare/tag link is appended to the
 * reference footer.
 *
 * CLI usage:
 *   node update-changelog.mjs <version>
 *
 * Idempotency guard: exits successfully without changes if a section for the
 * version already exists.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { collectCommits, latestTag, parseSubject, renderBullet } from './changelog.mjs';

const CHANGELOG_PATH = 'CHANGELOG.md';

/**
 * Conventional-commit type -> Keep-a-Changelog section. Applied ONLY by branch 2
 * (when CHANGELOG.md has no `[Unreleased]` section to promote). Types absent
 * from this map do not contribute to the generated section.
 */
export const TYPE_TO_SECTION = {
  feat: 'Added',
  fix: 'Fixed',
  refactor: 'Changed',
  perf: 'Changed',
};

/** Output order of the mapped sections. */
export const SECTION_ORDER = ['Added', 'Fixed', 'Changed'];

/** Matches a `## [Unreleased]` heading (case-insensitive, any spacing). */
export const UNRELEASED_HEADING_RE = /^##\s+\[Unreleased\]/im;

/** Read a UTF-8 file, tolerating a leading BOM (common on Windows editors). */
export function readFile(path, encoding = 'utf8') {
  return readFileSync(path, encoding).replace(/^\uFEFF/, '');
}

/**
 * Whether CHANGELOG.md contains an `[Unreleased]` section.
 * @param {string} changelog
 * @returns {boolean}
 */
export function hasUnreleasedSection(changelog) {
  return UNRELEASED_HEADING_RE.test(changelog);
}

/**
 * Branch 1: rename the `## [Unreleased]` heading to `## [<version>] - <date>`,
 * preserving the section body verbatim.
 * @param {string} changelog
 * @param {string} version Version without the leading "v".
 * @param {string} date ISO date (YYYY-MM-DD).
 * @returns {string}
 */
export function promoteUnreleased(changelog, version, date) {
  const lines = changelog.split('\n');
  const index = lines.findIndex((line) => UNRELEASED_HEADING_RE.test(line));
  if (index === -1) {
    throw new Error('CHANGELOG.md has no [Unreleased] section to convert.');
  }
  lines[index] = `## [${version}] - ${date}`;
  return lines.join('\n');
}

/**
 * Branch 2/3: group commits by TYPE_TO_SECTION and render the release section.
 * @param {string} version Version without the leading "v".
 * @param {string} date ISO date (YYYY-MM-DD).
 * @param {Array<{ subject: string, body: string }>} commits Collected commits.
 * @returns {{ section: string, sections: string[] }} `sections` lists the titles
 *   that received content; it is empty when no commit mapped to a section, in
 *   which case `section` is the version heading with a blank body.
 */
export function buildMappedSection(version, date, commits) {
  const buckets = new Map(SECTION_ORDER.map((title) => [title, []]));
  for (const commit of commits) {
    const parsed = parseSubject(commit.subject);
    if (!parsed) continue;
    const title = TYPE_TO_SECTION[parsed.type];
    if (!title) continue;
    buckets.get(title).push(commit);
  }

  const lines = [`## [${version}] - ${date}`, ''];
  const sections = [];
  for (const title of SECTION_ORDER) {
    const bullets = buckets.get(title).map(renderBullet);
    if (bullets.length === 0) continue;
    sections.push(title);
    lines.push(`### ${title}`, '', ...bullets, '');
  }

  return {
    section: sections.length === 0 ? `## [${version}] - ${date}\n` : lines.join('\n'),
    sections,
  };
}

/**
 * Insert the section immediately before the first existing `## [...]` entry
 * (below the file header). Throws when the changelog has no entries to position
 * against, keeping the tool simple and predictable.
 * @param {string} changelog
 * @param {string} section
 * @returns {string}
 */
export function insertSection(changelog, section) {
  const lines = changelog.split('\n');
  const index = lines.findIndex((line) => line.startsWith('## ['));
  if (index === -1) {
    throw new Error(
      'CHANGELOG.md has no existing version sections; cannot position the new one.',
    );
  }
  lines.splice(index, 0, section);
  return lines.join('\n');
}

/** Repository base URL from the root package.json (trailing ".git" stripped). */
export function repositoryUrl() {
  const pkg = JSON.parse(readFile('package.json'));
  return String(pkg.repository?.url ?? '').replace(/\.git$/, '');
}

function main() {
  const version = process.argv[2];
  if (!version || !/^\d+\.\d+\.\d+(?:[-+].+)?$/.test(version)) {
    console.error(`Invalid or missing version '${version ?? ''}'. Expected semver such as 1.2.3.`);
    process.exit(1);
  }

  const changelog = readFile(CHANGELOG_PATH);
  if (changelog.includes(`## [${version}]`)) {
    console.log(`CHANGELOG.md already contains a section for ${version}. Nothing to do.`);
    process.exit(0);
  }

  const date = new Date().toISOString().slice(0, 10);
  const previousTag = latestTag();
  let updated;

  // Branch 1 takes precedence: promote an existing [Unreleased] section as-is.
  if (hasUnreleasedSection(changelog)) {
    updated = promoteUnreleased(changelog, version, date);
    console.log(`Converted the [Unreleased] section into ${version}.`);
  } else {
    // Branch 2/3: derive the section from commits, blank when nothing maps.
    const { section, sections } = buildMappedSection(version, date, collectCommits(previousTag));
    updated = insertSection(changelog, section);
    if (sections.length === 0) {
      console.log(
        `Added a blank ${version} section to CHANGELOG.md ` +
          `(no commit mapped to a section since ${previousTag ?? 'the repository root'}).`,
      );
    } else {
      console.log(
        `Added a ${version} section to CHANGELOG.md ` +
          `(${sections.join(', ')}; previous tag: ${previousTag ?? 'none'}).`,
      );
    }
  }

  const repoUrl = repositoryUrl();
  const link = previousTag
    ? `[${version}]: ${repoUrl}/compare/${previousTag}...v${version}`
    : `[${version}]: ${repoUrl}/releases/tag/v${version}`;
  const withLink = `${updated.replace(/\s+$/, '\n')}\n${link}\n`;

  writeFileSync(CHANGELOG_PATH, withLink);
  console.log(`Updated CHANGELOG.md for ${version}.`);
}

if (basename(process.argv[1] ?? '') === 'update-changelog.mjs') {
  main();
}
