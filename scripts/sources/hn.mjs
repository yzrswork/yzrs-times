// Hacker News（Algolia Search API）。front_page / show_hn の2クエリで使う。
import { fetchWithTimeout, makeId, toIso } from '../util.mjs';

export async function fetchItems(sourceDef, ctx) {
  const url = `https://hn.algolia.com/api/v1/search?tags=${encodeURIComponent(sourceDef.query)}&hitsPerPage=30`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`hn algolia ${res.status}`);
  const data = await res.json();
  const out = [];
  for (const hit of data.hits ?? []) {
    const title = hit.title || hit.story_title;
    const storyUrl = hit.url || hit.story_url || `https://news.ycombinator.com/item?id=${hit.objectID}`;
    if (!title) continue;
    out.push({
      id: makeId(sourceDef.id, hit.objectID),
      sourceId: sourceDef.id,
      source: sourceDef.name,
      title: title.trim(),
      url: storyUrl,
      snippet: (hit.story_text || '').replace(/\s+/g, ' ').trim().slice(0, 300),
      publishedAt: toIso(hit.created_at) ?? ctx.now.toISOString(),
      lang: sourceDef.lang || 'en',
      signals: { hnPoints: hit.points ?? 0, hnComments: hit.num_comments ?? 0 },
    });
  }
  return out;
}
