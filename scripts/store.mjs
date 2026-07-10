// data/ と public/data/ の読み書きを集約するモジュール。
// 他のモジュール（collect/rank/edit/build-issue）はファイルパスを直接扱わない。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256 } from './util.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = path.join(ROOT, 'data');
export const PUBLIC_DATA_DIR = path.join(ROOT, 'public', 'data');
export const ISSUES_DIR = path.join(PUBLIC_DATA_DIR, 'issues');

const GEM_HISTORY_FILE = path.join(DATA_DIR, 'gem-history.json');
const SUMMARY_CACHE_FILE = path.join(DATA_DIR, 'summary-cache.json');
const SOURCE_HEALTH_FILE = path.join(DATA_DIR, 'source-health.json');
const LAST_MESSAGE_FILE = path.join(DATA_DIR, 'last-issue-message.txt');
const LATEST_FILE = path.join(PUBLIC_DATA_DIR, 'latest.json');
const MANIFEST_FILE = path.join(PUBLIC_DATA_DIR, 'index-manifest.json');

const GEM_HISTORY_DAYS = 30;
const SUMMARY_CACHE_DAYS = 90;

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(obj, null, 2)}\n`, 'utf8');
}

function monthOf(dateStr) {
  return dateStr.slice(0, 7);
}

function issueIndexPath(month) {
  return path.join(PUBLIC_DATA_DIR, `issues-index-${month}.json`);
}

function readIssueIndex(month) {
  return readJson(issueIndexPath(month), { schemaVersion: 1, month, issues: [] });
}

function writeIssueIndex(month, index) {
  writeJson(issueIndexPath(month), index);
}

function allIssueIndexFiles() {
  if (!fs.existsSync(PUBLIC_DATA_DIR)) return [];
  return fs.readdirSync(PUBLIC_DATA_DIR).filter((f) => /^issues-index-\d{4}-\d{2}\.json$/.test(f));
}

// 同じ date+edition が既に発行済みならその号情報を返す（採番の冪等性の基盤）。
export function findExistingIssue(date, edition) {
  const month = monthOf(date);
  const index = readIssueIndex(month);
  return index.issues.find((i) => i.date === date && i.edition === edition) ?? null;
}

// 全月次indexを走査して最大号数+1を返す。どのindexにも既存の号がなければ1。
export function nextIssueNo() {
  let max = 0;
  for (const file of allIssueIndexFiles()) {
    const index = readJson(path.join(PUBLIC_DATA_DIR, file), { issues: [] });
    for (const i of index.issues) {
      if (typeof i.issueNo === 'number' && i.issueNo > max) max = i.issueNo;
    }
  }
  return max + 1;
}

// date+editionの号数を決める：既存なら再利用、なければ新規採番。
export function resolveIssueNo(date, edition) {
  const existing = findExistingIssue(date, edition);
  return existing ? existing.issueNo : nextIssueNo();
}

export function issuePath(date, edition) {
  return path.join(ISSUES_DIR, `${date}-${edition}.json`);
}

// 号を保存し、月次index・latest.json・last-issue-message.txt を更新する。
export function saveIssue(issue) {
  writeJson(issuePath(issue.date, issue.edition), issue);
  writeJson(LATEST_FILE, issue);

  const month = monthOf(issue.date);
  const index = readIssueIndex(month);
  const entry = {
    issueNo: issue.issueNo,
    date: issue.date,
    edition: issue.edition,
    theme: issue.theme?.title ?? '',
    path: `issues/${issue.date}-${issue.edition}.json`,
  };
  const pos = index.issues.findIndex((i) => i.date === issue.date && i.edition === issue.edition);
  if (pos >= 0) index.issues[pos] = entry;
  else index.issues.push(entry);
  index.issues.sort((a, b) => a.issueNo - b.issueNo);
  writeIssueIndex(month, index);

  const manifest = readJson(MANIFEST_FILE, { schemaVersion: 1, months: [] });
  if (!manifest.months.includes(month)) {
    manifest.months.push(month);
    manifest.months.sort();
  }
  writeJson(MANIFEST_FILE, manifest);

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(
    LAST_MESSAGE_FILE,
    `Issue #${issue.issueNo} — ${issue.date} Morning Edition『${issue.theme?.title ?? ''}』\n`,
    'utf8',
  );

  if (issue.hiddenGem?.article) {
    addGemHistory(issue.hiddenGem.article.id, issue.hiddenGem.article.url, issue.date);
  }

  return entry;
}

export function loadLatestIssue() {
  return readJson(LATEST_FILE, null);
}

// --- Hidden Gem 履歴（30日再掲禁止） ---
export function getGemHistory() {
  const h = readJson(GEM_HISTORY_FILE, { schemaVersion: 1, entries: [] });
  const cutoff = Date.now() - GEM_HISTORY_DAYS * 86400000;
  h.entries = h.entries.filter((e) => new Date(e.date).getTime() >= cutoff);
  return h;
}

export function addGemHistory(id, url, date) {
  const h = getGemHistory();
  h.entries.push({ id, url, date });
  writeJson(GEM_HISTORY_FILE, h);
}

// --- 要約キャッシュ（90日でprune） ---
export function urlCacheKey(url) {
  return sha256(url).slice(0, 16);
}

export function getSummaryCache() {
  const c = readJson(SUMMARY_CACHE_FILE, { schemaVersion: 1, entries: {} });
  const cutoff = Date.now() - SUMMARY_CACHE_DAYS * 86400000;
  for (const [key, v] of Object.entries(c.entries)) {
    if (!v.cachedAt || new Date(v.cachedAt).getTime() < cutoff) delete c.entries[key];
  }
  return c;
}

export function setSummaryCache(cache, url, summaryJa) {
  cache.entries[urlCacheKey(url)] = { url, summaryJa, cachedAt: new Date().toISOString() };
}

export function saveSummaryCache(cache) {
  writeJson(SUMMARY_CACHE_FILE, cache);
}

// --- ソース死活（連続失敗カウント） ---
export function getSourceHealth() {
  return readJson(SOURCE_HEALTH_FILE, { schemaVersion: 1, sources: {} });
}

export function recordSourceResult(health, sourceId, ok) {
  const entry = health.sources[sourceId] ?? { consecutiveFailures: 0, lastSuccessAt: null, lastFailureAt: null };
  if (ok) {
    entry.consecutiveFailures = 0;
    entry.lastSuccessAt = new Date().toISOString();
  } else {
    entry.consecutiveFailures = (entry.consecutiveFailures ?? 0) + 1;
    entry.lastFailureAt = new Date().toISOString();
  }
  health.sources[sourceId] = entry;
  return health;
}

export function saveSourceHealth(health) {
  writeJson(SOURCE_HEALTH_FILE, health);
}

export function readConfigJson(relPath) {
  return readJson(path.join(ROOT, relPath), null);
}

export const rootPath = (...segs) => path.join(ROOT, ...segs);
