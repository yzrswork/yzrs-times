// Open-Meteo daily forecast。weathercode(WMO)を日本語の要約とアイコン名に変換する。
import { fetchWithTimeout } from '../util.mjs';

const WEATHER_CODE_MAP = {
  0: { summary: '快晴', icon: 'sunny' },
  1: { summary: '晴れ', icon: 'sunny' },
  2: { summary: '晴れ時々曇り', icon: 'partly-cloudy' },
  3: { summary: '曇り', icon: 'cloudy' },
  45: { summary: '霧', icon: 'fog' },
  48: { summary: '霧氷', icon: 'fog' },
  51: { summary: '霧雨', icon: 'rain' },
  53: { summary: '霧雨', icon: 'rain' },
  55: { summary: '強い霧雨', icon: 'rain' },
  56: { summary: '着氷性の霧雨', icon: 'rain' },
  57: { summary: '着氷性の霧雨', icon: 'rain' },
  61: { summary: '弱い雨', icon: 'rain' },
  63: { summary: '雨', icon: 'rain' },
  65: { summary: '強い雨', icon: 'rain' },
  66: { summary: '着氷性の雨', icon: 'rain' },
  67: { summary: '着氷性の雨', icon: 'rain' },
  71: { summary: '弱い雪', icon: 'snow' },
  73: { summary: '雪', icon: 'snow' },
  75: { summary: '強い雪', icon: 'snow' },
  77: { summary: '霧雪', icon: 'snow' },
  80: { summary: 'にわか雨', icon: 'rain' },
  81: { summary: 'にわか雨', icon: 'rain' },
  82: { summary: '激しいにわか雨', icon: 'rain' },
  85: { summary: 'にわか雪', icon: 'snow' },
  86: { summary: '激しいにわか雪', icon: 'snow' },
  95: { summary: '雷雨', icon: 'thunder' },
  96: { summary: '雷雨（雹あり）', icon: 'thunder' },
  99: { summary: '雷雨（雹あり）', icon: 'thunder' },
};

export async function fetchWeather(location) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${location.lat}&longitude=${location.lon}` +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=Asia%2FTokyo';
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`weather ${res.status}`);
  const data = await res.json();
  const daily = data.daily ?? {};
  const code = (daily.weather_code ?? daily.weathercode ?? [])[0];
  const meta = WEATHER_CODE_MAP[code] ?? { summary: '不明', icon: 'cloudy' };
  const tempMax = daily.temperature_2m_max?.[0];
  const tempMin = daily.temperature_2m_min?.[0];
  const precip = daily.precipitation_probability_max?.[0];
  return {
    location: location.name,
    summary: meta.summary,
    icon: meta.icon,
    tempMax: typeof tempMax === 'number' ? Math.round(tempMax) : null,
    tempMin: typeof tempMin === 'number' ? Math.round(tempMin) : null,
    precipChancePct: typeof precip === 'number' ? Math.round(precip) : null,
  };
}
