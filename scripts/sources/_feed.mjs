// rss.mjs / hatebu.mjs 共通のフィード取得ヘルパー（rss-parserはRSS1.0/RDFも読める）。
import Parser from 'rss-parser';
import { USER_AGENT, FETCH_TIMEOUT_MS } from '../util.mjs';

const parser = new Parser({
  timeout: FETCH_TIMEOUT_MS,
  headers: { 'User-Agent': USER_AGENT },
});

export async function parseFeed(url) {
  const feed = await parser.parseURL(url);
  return feed.items ?? [];
}
