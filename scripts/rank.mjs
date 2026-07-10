// 重複除去 → Heat Index計算 → ソース別クォータ・版構成を考慮した候補選定。
// AIを使わない決定論的コード（README憲法5番）。
import { normalizeUrl, clamp } from './util.mjs';

// --- 重複除去（URL正規化 + タイトルJaccard >= 0.7） ---
export function dedupe(items) {
  const groups = [];
  for (const item of items) {
    const normUrl = normalizeUrl(item.url);
    const tokens = tokenize(item.title);
    const match = groups.find((g) => g.normUrl === normUrl || jaccard(tokens, g.tokens) >= 0.7);
    if (match) match.items.push(item);
    else groups.push({ normUrl, tokens, items: [item] });
  }
  return groups.map(mergeGroup);
}

function tokenize(title) {
  return new Set(
    (title || '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter(Boolean),
  );
}

function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

const SIGNAL_KEYS = ['hnPoints', 'hnComments', 'hatebuCount', 'stars'];

function mergeGroup(group) {
  const items = group.items;
  const primary = items.slice().sort((a, b) => signalScore(b) - signalScore(a))[0];
  const sourceIds = [...new Set(items.map((i) => i.sourceId))];
  const merged = {};
  for (const key of SIGNAL_KEYS) {
    merged[key] = Math.max(0, ...items.map((i) => i.signals?.[key] ?? 0));
  }
  return { ...primary, signals: merged, crossSourceIds: sourceIds };
}

function signalScore(item) {
  const s = item.signals ?? {};
  return (s.hnPoints ?? 0) + (s.hatebuCount ?? 0) * 2 + (s.stars ?? 0);
}

// --- Heat計算 ---
// noSignalClampSourceIds: NHK等「シグナルを持たないメイン候補ソース」。
// 常に冷たく見える不公平を防ぐため40〜65℃帯に収める。gemプールなど競合対象外のソースは対象外。
export function computeHeat(items, now, noSignalClampSourceIds) {
  const bySource = groupBy(items, (i) => i.sourceId);
  return items.map((it) => {
    const ageHours = Math.max(0.5, (now.getTime() - new Date(it.publishedAt).getTime()) / 3600000);
    const crossSources = it.crossSourceIds?.length || 1;
    const hnPoints = it.signals?.hnPoints ?? 0;
    const hatebuCount = it.signals?.hatebuCount ?? 0;
    const primary = hnPoints || hatebuCount;
    const velocity = primary > 0 ? round1(primary / ageHours) : 0;

    let temperature;
    if (primary > 0) {
      const peers = bySource.get(it.sourceId) ?? [it];
      const peerVelocities = peers.map((p) => {
        const pPrimary = (p.signals?.hnPoints ?? 0) || (p.signals?.hatebuCount ?? 0);
        const pAge = Math.max(0.5, (now.getTime() - new Date(p.publishedAt).getTime()) / 3600000);
        return pPrimary > 0 ? pPrimary / pAge : 0;
      });
      const pct = percentileRank(velocity, peerVelocities);
      const crossBonus = Math.min(crossSources - 1, 3) * 5;
      const recencyBonus = (Math.max(0, 24 - ageHours) / 24) * 10;
      temperature = clamp(Math.round(35 + pct * 45 + crossBonus + recencyBonus), 0, 100);
    } else {
      const recencyFactor = clamp((48 - ageHours) / 48, 0, 1);
      const crossBonus = Math.min(crossSources - 1, 2) * 5;
      const base = 40 + recencyFactor * 15 + crossBonus;
      temperature = noSignalClampSourceIds.has(it.sourceId)
        ? clamp(Math.round(base), 40, 65)
        : clamp(Math.round(base), 0, 100);
    }

    return {
      ...it,
      heat: {
        temperature,
        signals: { hnPoints, hatebuCount, ageHours: Math.round(ageHours), crossSources, velocity },
      },
    };
  });
}

function percentileRank(value, group) {
  if (group.length <= 1) return value > 0 ? 1 : 0;
  const countBelow = group.filter((v) => v < value).length;
  return countBelow / (group.length - 1);
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

function groupBy(arr, keyFn) {
  const m = new Map();
  for (const it of arr) {
    const k = keyFn(it);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(it);
  }
  return m;
}

// --- ソース別クォータ ---
export function applyPerSourceQuota(items, quota) {
  const bySource = groupBy(items, (i) => i.sourceId);
  const out = [];
  for (const group of bySource.values()) {
    out.push(...group.slice().sort((a, b) => b.heat.temperature - a.heat.temperature).slice(0, quota));
  }
  return out;
}

// --- 版構成を考慮した候補選定（セクション間でラウンドロビンし多様性を確保） ---
export function selectCandidates(items, editionConfig, maxCandidates) {
  const sourceToSection = new Map();
  for (const section of editionConfig.sections) {
    for (const sourceId of section.sources) sourceToSection.set(sourceId, section.id);
  }
  const buckets = editionConfig.sections.map((s) => ({
    id: s.id,
    items: items.filter((i) => sourceToSection.get(i.sourceId) === s.id).sort((a, b) => b.heat.temperature - a.heat.temperature),
  }));

  const selected = [];
  let progressed = true;
  while (selected.length < maxCandidates && progressed) {
    progressed = false;
    for (const bucket of buckets) {
      if (selected.length >= maxCandidates) break;
      const next = bucket.items.shift();
      if (next) {
        selected.push(next);
        progressed = true;
      }
    }
  }
  return selected.sort((a, b) => b.heat.temperature - a.heat.temperature);
}

// --- Hidden Gem候補プール ---
export function selectGemCandidates(items, { blockedDomains, gemHistoryEntries, limit = 5 }) {
  const blockedUrls = new Set(gemHistoryEntries.map((e) => normalizeUrl(e.url)));
  const eligible = items.filter((it) => {
    if (blockedDomains.some((d) => it.url.includes(d))) return false;
    if (blockedUrls.has(normalizeUrl(it.url))) return false;
    return true;
  });

  // ソース間で多様性を確保しつつ温度順に選ぶ（ラウンドロビン）。
  const bySource = groupBy(eligible, (i) => i.sourceId);
  for (const arr of bySource.values()) arr.sort((a, b) => b.heat.temperature - a.heat.temperature);
  const buckets = [...bySource.values()];
  const selected = [];
  let progressed = true;
  while (selected.length < limit && progressed) {
    progressed = false;
    for (const bucket of buckets) {
      if (selected.length >= limit) break;
      const next = bucket.shift();
      if (next) {
        selected.push(next);
        progressed = true;
      }
    }
  }
  return selected.sort((a, b) => b.heat.temperature - a.heat.temperature);
}

// --- エントリポイント ---
export function rank(items, { sourcesConfig, editionConfig, gemHistoryEntries, now }) {
  const deduped = dedupe(items);

  const gemSourceIds = new Set(sourcesConfig.sources.filter((s) => s.gemPool).map((s) => s.id));
  const noSignalClampSourceIds = new Set(
    sourcesConfig.sources.filter((s) => !s.gemPool && s.type === 'rss').map((s) => s.id),
  );

  const withHeat = computeHeat(deduped, now, noSignalClampSourceIds);

  const mainPool = withHeat.filter((it) => !gemSourceIds.has(it.sourceId));
  const gemPool = withHeat.filter((it) => gemSourceIds.has(it.sourceId));

  const afterQuota = applyPerSourceQuota(mainPool, sourcesConfig.editor.perSourceQuota);
  const candidates = selectCandidates(afterQuota, editionConfig, sourcesConfig.editor.maxCandidates);

  const gemCandidates = selectGemCandidates(gemPool, {
    blockedDomains: sourcesConfig.hiddenGem.blockedDomains,
    gemHistoryEntries,
    limit: 5,
  });

  return { candidates, gemCandidates };
}
