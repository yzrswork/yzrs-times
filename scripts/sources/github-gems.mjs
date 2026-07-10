// GitHub search API から「小さなOSS」を探す。日付シードでtopicsを2個ローテーションし、
// sources.jsonのhiddenGem設定（stars範囲・除外ドメイン）をここで反映する。
import { fetchWithTimeout, makeId } from '../util.mjs';

export async function fetchItems(sourceDef, ctx) {
  const topics = pickTopics(sourceDef.topics ?? [], ctx.dateSeed, 2);
  const { githubStarsMin = 100, githubStarsMax = 3000, blockedDomains = [] } = ctx.hiddenGem ?? {};
  const sinceDate = new Date(ctx.now.getTime() - 90 * 86400000).toISOString().slice(0, 10);

  const headers = { Accept: 'application/vnd.github+json' };
  if (ctx.githubToken) headers.Authorization = `Bearer ${ctx.githubToken}`;

  const results = [];
  let anyTopicSucceeded = false;
  for (const topic of topics) {
    const q = `topic:${topic} stars:${githubStarsMin}..${githubStarsMax} pushed:>${sinceDate}`;
    const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=10`;
    const res = await fetchWithTimeout(url, { headers });
    if (!res.ok) continue; // トピック単位でfail-soft（全滅なら下でエラーにする）
    anyTopicSucceeded = true;
    const data = await res.json();
    for (const repo of data.items ?? []) {
      if (isBlocked(repo.html_url, blockedDomains)) continue;
      results.push({
        id: makeId(sourceDef.id, repo.full_name),
        sourceId: sourceDef.id,
        source: sourceDef.name,
        title: repo.description ? `${repo.full_name} — ${repo.description}` : repo.full_name,
        url: repo.html_url,
        snippet: (repo.description || '').slice(0, 300),
        publishedAt: repo.pushed_at ?? ctx.now.toISOString(),
        lang: sourceDef.lang || 'en',
        signals: { stars: repo.stargazers_count ?? 0 },
      });
    }
  }
  // 全トピックがHTTPレベルで失敗した場合は「0件成功」ではなく明確な失敗として扱う
  // （source-healthの連続失敗カウントを正しく反映するため）。
  if (topics.length > 0 && !anyTopicSucceeded) throw new Error('github-gems: all topic queries failed');
  return dedupeByUrl(results);
}

function pickTopics(topics, seed, n) {
  if (topics.length === 0) return [];
  const start = ((seed % topics.length) + topics.length) % topics.length;
  const out = [];
  for (let i = 0; i < Math.min(n, topics.length); i++) out.push(topics[(start + i) % topics.length]);
  return out;
}

function isBlocked(url, blockedDomains) {
  return blockedDomains.some((d) => url.includes(d));
}

function dedupeByUrl(items) {
  const seen = new Set();
  return items.filter((i) => (seen.has(i.url) ? false : (seen.add(i.url), true)));
}
