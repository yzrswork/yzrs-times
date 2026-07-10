// はてなブックマーク ホットエントリ（RSS/RDF）。ブックマーク数APIは失敗しても件数0で続行する。
import { parseFeed } from './_feed.mjs';
import { fetchWithTimeout, makeId, toIso, chunk } from '../util.mjs';

export async function fetchItems(sourceDef, ctx) {
  const items = await parseFeed(sourceDef.url);
  const out = [];
  for (const it of items) {
    const title = (it.title || '').trim();
    const url = (it.link || it.guid || '').trim();
    if (!title || !url) continue;
    out.push({
      id: makeId(sourceDef.id, url),
      sourceId: sourceDef.id,
      source: sourceDef.name,
      title,
      url,
      snippet: (it.contentSnippet || it.content || '').replace(/\s+/g, ' ').trim().slice(0, 300),
      publishedAt: toIso(it.isoDate || it.pubDate) ?? ctx.now.toISOString(),
      lang: sourceDef.lang || 'ja',
      signals: { hatebuCount: 0 },
    });
  }

  const counts = await fetchBookmarkCounts(out.map((i) => i.url)).catch(() => ({}));
  for (const item of out) {
    const c = counts[item.url];
    if (typeof c === 'number') item.signals.hatebuCount = c;
  }
  return out;
}

async function fetchBookmarkCounts(urls) {
  const result = {};
  for (const batch of chunk(urls, 50)) {
    if (batch.length === 0) continue;
    const qs = batch.map((u) => `url=${encodeURIComponent(u)}`).join('&');
    try {
      const res = await fetchWithTimeout(`https://bookmark.hatenaapis.com/count/entries?${qs}`);
      if (res.ok) Object.assign(result, await res.json());
    } catch {
      // 件数取得失敗はfail-soft（0件のまま続行）
    }
  }
  return result;
}
