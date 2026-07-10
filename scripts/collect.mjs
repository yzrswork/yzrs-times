// sources.jsonの各ソースをPromise.allSettledで並行取得する。
// AIは一切使わない（決定論的なfetch＋正規化のみ）。
import * as rss from './sources/rss.mjs';
import * as hatebu from './sources/hatebu.mjs';
import * as hn from './sources/hn.mjs';
import * as githubGems from './sources/github-gems.mjs';
import * as indieblog from './sources/indieblog.mjs';
import { fetchMarket } from './sources/coingecko.mjs';
import { fetchFearGreed } from './sources/feargreed.mjs';
import { fetchWeather } from './sources/weather.mjs';

const FETCHERS = {
  rss: rss.fetchItems,
  hatebu: hatebu.fetchItems,
  hn: hn.fetchItems,
  'github-gems': githubGems.fetchItems,
  indieblog: indieblog.fetchItems,
};

// health: store.getSourceHealth()の戻り値を渡し、この関数がミューテートして返す。
export async function collect(sourcesConfig, { now, githubToken, health, recordSourceResult }) {
  const dateSeed = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(now).replaceAll('-', ''));
  const ctx = { now, githubToken, hiddenGem: sourcesConfig.hiddenGem, dateSeed };

  const settled = await Promise.allSettled(
    sourcesConfig.sources.map((src) => {
      const fetcher = FETCHERS[src.type];
      if (!fetcher) return Promise.reject(new Error(`unknown source type: ${src.type}`));
      return fetcher(src, ctx);
    }),
  );

  const items = [];
  const unavailableSources = [];
  settled.forEach((res, i) => {
    const src = sourcesConfig.sources[i];
    if (res.status === 'fulfilled') {
      items.push(...res.value);
      recordSourceResult(health, src.id, true);
    } else {
      unavailableSources.push(src.name);
      recordSourceResult(health, src.id, false);
    }
  });

  const [weatherRes, marketRes, fearGreedRes] = await Promise.allSettled([
    fetchWeather(sourcesConfig.weatherLocation),
    fetchMarket(sourcesConfig.coins),
    fetchFearGreed(),
  ]);

  if (weatherRes.status === 'rejected') unavailableSources.push('Weather');
  if (marketRes.status === 'rejected') unavailableSources.push('Market');
  if (fearGreedRes.status === 'rejected') unavailableSources.push('Fear & Greed');

  return {
    items,
    unavailableSources,
    // 取得失敗はnull（紙面側はnullのブロックを丸ごと非表示にする契約）
    weather: weatherRes.status === 'fulfilled' ? weatherRes.value : null,
    coins: marketRes.status === 'fulfilled' ? marketRes.value : null,
    fearGreed: fearGreedRes.status === 'fulfilled' ? fearGreedRes.value : null,
  };
}

