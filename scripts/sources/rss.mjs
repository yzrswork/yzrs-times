// NHK / Yahoo! / Google Trends など単純なRSSソース。
// Google Trendsは非公式フィードのため形式が崩れることがある＝呼び出し元(collect.mjs)が
// Promise.allSettledでfail-softに扱う前提で、ここでは素直に投げる。
import { parseFeed } from './_feed.mjs';
import { makeId, toIso } from '../util.mjs';

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
      snippet: (it.contentSnippet || it.content || it.summary || '').replace(/\s+/g, ' ').trim().slice(0, 300),
      publishedAt: toIso(it.isoDate || it.pubDate) ?? ctx.now.toISOString(),
      lang: sourceDef.lang || 'ja',
      signals: {},
    });
  }
  return out;
}
