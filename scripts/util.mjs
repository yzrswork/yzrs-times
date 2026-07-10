// 共有の小さなヘルパー。外部HTTPは必ずここのfetchWithTimeoutを経由させ、
// タイムアウトとUser-Agentの付与漏れを防ぐ。
import crypto from 'node:crypto';

export const USER_AGENT = 'YZRS-Times/0.1 (personal newspaper bot)';
export const FETCH_TIMEOUT_MS = 15000;

export async function fetchWithTimeout(url, opts = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...opts,
      headers: { 'User-Agent': USER_AGENT, ...(opts.headers || {}) },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export function sha256(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

export function shortHash(str, len = 8) {
  return sha256(str).slice(0, len);
}

export function makeId(sourceId, key) {
  return `${sourceId}-${shortHash(String(key))}`;
}

// クエリのトラッキングパラメータ除去・末尾スラッシュ統一による正規化（重複除去用）。
const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'ref', 'ref_src', 'fbclid', 'gclid', 'igshid', 'spm',
]);

export function normalizeUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    u.hash = '';
    for (const p of [...u.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(p)) u.searchParams.delete(p);
    }
    u.searchParams.sort();
    const path = u.pathname.replace(/\/+$/, '') || '/';
    const query = u.searchParams.toString();
    return `${u.hostname.toLowerCase()}${path}${query ? `?${query}` : ''}`;
  } catch {
    return rawUrl.trim().toLowerCase();
  }
}

export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

export function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export function toIso(dateLike) {
  if (!dateLike) return null;
  const t = new Date(dateLike);
  return Number.isNaN(t.getTime()) ? null : t.toISOString();
}

// JSTカレンダー日（YYYY-MM-DD）を返す。号の"date"はこれを使う。
export function jstDateStr(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function jstDateDisplay(date = new Date()) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  }).format(date);
}

export async function withRetry(fn, { retries = 2, baseDelayMs = 500 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, baseDelayMs * 2 ** attempt));
      }
    }
  }
  throw lastErr;
}
