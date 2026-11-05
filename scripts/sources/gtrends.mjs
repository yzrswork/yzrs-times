// Google トレンド（急上昇ワード）専用フェッチャー。
// このフィードは全itemの<link>がフィードURL自身になるため、そのままではID・重複除去・
// 要約キャッシュがすべて1件に衝突する。キーワードごとの検索URLを作って記事URLにする。
// 非公式フィードのため形式が崩れることがある＝呼び出し元(collect.mjs)が
// Promise.allSettledでfail-softに扱う前提で、ここでは素直に投げる。
import { parseFeed } from './_feed.mjs';
import { makeId, toIso } from '../util.mjs';

export function trendsUrl(keyword, geo = 'JP') {
  return `https://trends.google.com/trends/explore?geo=${encodeURIComponent(geo)}&q=${encodeURIComponent(keyword)}`;
}

export async function fetchItems(sourceDef, ctx) {
  const geo = sourceDef.geo || 'JP';
  const items = await parseFeed(sourceDef.url);
  const out = [];
  for (const it of items) {
    const title = (it.title || '').trim();
    if (!title) continue;
    const url = trendsUrl(title, geo);
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
