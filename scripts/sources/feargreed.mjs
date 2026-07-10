// alternative.me Fear & Greed Index。
import { fetchWithTimeout } from '../util.mjs';

export async function fetchFearGreed() {
  const res = await fetchWithTimeout('https://api.alternative.me/fng/');
  if (!res.ok) throw new Error(`feargreed ${res.status}`);
  const data = await res.json();
  const d = data.data?.[0];
  if (!d) throw new Error('feargreed: empty response');
  return { value: Number(d.value), label: d.value_classification };
}
