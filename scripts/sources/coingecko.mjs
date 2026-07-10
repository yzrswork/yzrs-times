// CoinGecko markets API。USD呼び出しは必須、JPY呼び出しは失敗してもpriceJpy:nullで続行。
import { fetchWithTimeout } from '../util.mjs';

export async function fetchMarket(coinIds) {
  const ids = coinIds.join(',');
  const usdRes = await fetchWithTimeout(
    `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${encodeURIComponent(ids)}&sparkline=true`,
  );
  if (!usdRes.ok) throw new Error(`coingecko usd ${usdRes.status}`);
  const usdData = await usdRes.json();

  let jpyById = {};
  try {
    const jpyRes = await fetchWithTimeout(
      `https://api.coingecko.com/api/v3/coins/markets?vs_currency=jpy&ids=${encodeURIComponent(ids)}`,
    );
    if (jpyRes.ok) {
      const jpyData = await jpyRes.json();
      jpyById = Object.fromEntries(jpyData.map((c) => [c.id, c.current_price]));
    }
  } catch {
    // JPY取得失敗はfail-soft
  }

  return usdData.map((c) => ({
    id: c.id,
    symbol: (c.symbol || '').toUpperCase(),
    priceUsd: c.current_price ?? null,
    priceJpy: jpyById[c.id] ?? null,
    change24hPct: roundOrNull(c.price_change_percentage_24h, 2),
    sparkline7d: downsample(c.sparkline_in_7d?.price ?? [], 7),
  }));
}

function roundOrNull(n, digits) {
  return typeof n === 'number' ? Number(n.toFixed(digits)) : null;
}

// 168点（7日分の1時間おき）程度のsparklineを約7点にダウンサンプルする。
function downsample(arr, n) {
  if (arr.length === 0) return [];
  if (arr.length <= n) return arr.map((v) => roundOrNull(v, v < 1 ? 6 : 2));
  const step = (arr.length - 1) / (n - 1);
  const out = [];
  for (let i = 0; i < n; i++) {
    const idx = Math.round(i * step);
    out.push(arr[Math.min(arr.length - 1, idx)]);
  }
  return out.map((v) => roundOrNull(v, v < 1 ? 6 : 2));
}
