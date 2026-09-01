#!/usr/bin/env node
/**
 * Conventional-commit changelog generator shared by the release workflows.
 *
 * Collects commit subjects (and bodies, for BREAKING CHANGE detection) from a
 * git range, groups them into Keep-a-Changelog style sections, and renders a
 * `## [X.Y.Z] - YYYY-MM-DD` markdown block.
 *
 * CLI usage:
 *   node changelog.mjs <version> [from-ref]
 *
 *   <version>   Release version WITHOUT the leading "v" (e.g. "1.2.3").
 *   [from-ref]  Optional git ref to start the log from (usually the previous
 *               release tag, e.g. "v1.2.2"). When omitted or empty, the log
 *               starts from the repository root (first release).
 *
 * Also importable as a module: `collectCommits()`, `generateSection()`.
 * Depends on nothing outside Node's standard library, mirroring the
 * dependency-light approach of the rest of the release tooling.
 */
import { execFileSync } from 'node:child_process';

/**
 * Conventional-commit type -> Keep-a-Changelog section mapping, in output
 * order. Types not listed here fall into "Internal" (chores, CI, tests, ...).
 */
const SECTIONS = [
  { title: 'Added', types: ['feat'] },
  { title: 'Fixed', types: ['fix'] },
  { title: 'Changed', types: ['refactor', 'perf'] },
  { title: 'Documentation', types: ['docs'] },
  { title: 'Reverted', types: ['revert'] },
  { title: 'Internal', types: ['test', 'build', 'ci', 'chore'] },
];
const FALLBACK_SECTION = 'Internal';

/** Git log record format: subject \x1f body \x1e (record separator). */
const GIT_LOG_FORMAT = '%s%x1f%b%x1e';

/**
 * Resolve the most recent `v*` release tag (semver-sorted), or null when the
 * repository has no tags yet.
 * @returns {string | null} Tag name including the leading "v", e.g. "v1.2.3".
 */
export function latestTag() {
  const tags = execFileSync('git', ['tag', '-l', 'v[0-9]*'], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .sort(compareVersions);
  return tags.length > 0 ? tags.at(-1) : null;
}

/** Semver-aware comparator for "v"-prefixed tags. */
function compareVersions(a, b) {
  const pa = a.replace(/^v/, '').split(/[.-]/).map(Number);
  const pb = b.replace(/^v/, '').split(/[.-]/).map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Collect the conventional commits introduced in a git range.
 *
 * Merge commits are skipped: they carry no semantic versioning signal.
 *
 * @param {string | null} fromRef Ref to start the log from (null = full history).
 * @param {string} [toRef='HEAD'] Ref to end the log at.
 * @returns {Array<{ subject: string, body: string }>}
 */
export function collectCommits(fromRef, toRef = 'HEAD') {
  const args = ['log', `--format=${GIT_LOG_FORMAT}`];
  if (fromRef) args.push(`${fromRef}..${toRef}`);
  const out = execFileSync('git', args, { encoding: 'utf8' });

  return out
    .split('\x1e') // record separator
    .map((record) => record.replace(/^\n+/, '').trimEnd())
    .filter(Boolean)
    .map((record) => {
      const [subject, ...bodyLines] = record.split('\x1f');
      return { subject: subject.trim(), body: bodyLines.join('\x1f').trim() };
    })
    .filter((commit) => !/^Merge /.test(commit.subject));
}

/**
 * Parse a conventional-commit subject into its parts.
 * @returns {{ type: string, scope: string | null, breaking: boolean, description: string } | null}
 *   Null when the subject is not a conventional commit.
 */
export function parseSubject(subject) {
  const match = subject.match(/^(\w+)(?:\(([^)]*)\))?(!)?:\s*(.*)$/);
  if (!match) return null;
  const [, type, scope, bang, description] = match;
  return {
    type: type.toLowerCase(),
    scope: scope || null,
    breaking: Boolean(bang),
    description: description.trim(),
  };
}

/** Whether a commit introduces a breaking change (subject "!" or body footer). */
function isBreaking(commit) {
  return Boolean(parseSubject(commit.subject)?.breaking) || /^BREAKING CHANGE:/m.test(commit.body);
}

/**
 * Render one commit as a changelog bullet. The conventional type prefix is
 * stripped; a scope becomes a bold prefix (release-please style).
 */
function renderBullet(commit) {
  const parsed = parseSubject(commit.subject);
  if (!parsed) return `- ${commit.subject}`;
  const scope = parsed.scope ? `**${parsed.scope}**: ` : '';
  const breaking = isBreaking(commit) ? ' *(BREAKING CHANGE)*' : '';
  return `- ${scope}${parsed.description}${breaking}`;
}

/**
 * Generate a Keep-a-Changelog style section for a version.
 * @param {string} version Version without the leading "v".
 * @param {string} date ISO date (YYYY-MM-DD) rendered in the heading.
 * @param {Array<{ subject: string, body: string }>} commits Collected commits.
 * @returns {string} Markdown section ending with a blank line.
 */
export function generateSection(version, date, commits) {
  const lines = [`## [${version}] - ${date}`, ''];

  if (commits.length === 0) {
    lines.push('No notable changes.', '');
    return lines.join('\n');
  }

  for (const { title, types } of SECTIONS) {
    const bullets = commits
      .map((commit) => {
        const parsed = parseSubject(commit.subject);
        if (parsed && !types.includes(parsed.type)) return null;
        if (!parsed && FALLBACK_SECTION !== title) return null;
        return renderBullet(commit);
      })
      .filter(Boolean);
    if (bullets.length === 0) continue;
    lines.push(`### ${title}`, '', ...bullets, '');
  }

  return lines.join('\n');
}

// --- CLI entry point -------------------------------------------------------
if (process.argv[1] && process.argv[1].endsWith('changelog.mjs')) {
  const [version, fromRef = ''] = process.argv.slice(2);
  if (!version) {
    console.error('Usage: node changelog.mjs <version> [from-ref]');
    process.exit(1);
  }
  const commits = collectCommits(fromRef || null);
  process.stdout.write(generateSection(version, new Date().toISOString().slice(0, 10), commits));
}
