// indieblog.page/random は302でランダムな個人ブログ記事にリダイレクトする。
// 完全にoptional：数回試して全滅したらエラーを投げ、呼び出し元(collect.mjs)のfail-softに委ねる
// （source-healthの連続失敗カウントを正しく反映するため、ここでは空配列を返さない）。
import { fetchWithTimeout, makeId } from '../util.mjs';

export async function fetchItems(sourceDef, ctx) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetchWithTimeout(sourceDef.url, { redirect: 'manual' });
      const location = res.headers.get('location');
      if (!location) { lastErr = new Error(`indieblog: no redirect (status ${res.status})`); continue; }
      const absoluteUrl = new URL(location, sourceDef.url).toString();
      const title = await fetchTitle(absoluteUrl);
      return [{
        id: makeId(sourceDef.id, absoluteUrl),
        sourceId: sourceDef.id,
        source: sourceDef.name,
        title: title || absoluteUrl,
        url: absoluteUrl,
        snippet: '',
        publishedAt: ctx.now.toISOString(),
        lang: sourceDef.lang || 'en',
        signals: {},
      }];
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr ?? new Error('indieblog: failed after retries');
}

async function fetchTitle(url) {
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return null;
    const html = await res.text();
    const m = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    return m ? m[1].trim().replace(/\s+/g, ' ') : null;
  } catch {
    return null;
  }
}
