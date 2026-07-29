import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PUBLIC = join(ROOT, 'public');
const CLIENT = 'ca-pub-8467165715973366';
const PUBLISHER = 'pub-8467165715973366';
const AUTHORITY = 'f08c47fec0942fa0';
const META = `<meta name="google-adsense-account" content="${CLIENT}"`;
const SCRIPT = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${CLIENT}`;
const errors = [];

function read(relativePath) {
  const path = join(PUBLIC, relativePath);
  if (!existsSync(path)) {
    errors.push(`公開ファイルがない: ${relativePath}`);
    return '';
  }
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

const contentPages = ['index.html', 'times/index.html', 'evening.html'];
const trustPages = ['about/index.html', 'privacy/index.html'];

for (const page of [...contentPages, ...trustPages]) {
  const html = read(page);
  if (!html.includes(META)) errors.push(`AdSenseメタタグがない: ${page}`);
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  if (new Set(ids).size !== ids.length) errors.push(`idが重複: ${page}`);
}

for (const page of contentPages) {
  const html = read(page);
  if (!html.includes(SCRIPT)) errors.push(`AdSenseコードがない: ${page}`);
  if (html.split(SCRIPT).length !== 2) errors.push(`AdSenseコードが1回ではない: ${page}`);
  for (const match of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\ssrc\s*=/.test(match[1])) continue;
    if (/type=["']application\/ld\+json["']/.test(match[1])) {
      try {
        JSON.parse(match[2]);
      } catch (error) {
        errors.push(`構造化データJSONエラー: ${page}: ${error.message}`);
      }
      continue;
    }
    try {
      new vm.Script(match[2], { filename: page });
    } catch (error) {
      errors.push(`インラインJavaScript構文エラー: ${page}: ${error.message}`);
    }
  }
}

const top = read('index.html');
for (const [label, expected] of [
  ['トップのcanonical', '<link rel="canonical" href="https://yzrswork.com/"'],
  ['旧号URLの互換転送', "new URL('/times/', location.origin)"],
  ['YZRS Times導線', 'href="/times/"'],
  ['note導線', 'href="https://note.com/yzrswork"'],
  ['問い合わせ導線', 'href="https://forms.gle/y3zyPFtuNh8qpj18A"'],
  ['広告・Amazon表記導線', 'href="/about/#advertising"'],
  ['OG画像', '<meta property="og:image" content="https://yzrswork.com/og.png"'],
  ['構造化データ', '<script type="application/ld+json">'],
]) {
  if (!top.includes(expected)) errors.push(`${label}がない`);
}
if (!existsSync(join(PUBLIC, 'og.png'))) errors.push('OG画像がない');

for (const url of [
  'https://apps.yzrswork.com/bench/',
  'https://apps.yzrswork.com/haisen/',
  'https://apps.yzrswork.com/build/',
  'https://apps.yzrswork.com/usbc/',
  'https://apps.yzrswork.com/glue/',
  'https://apps.yzrswork.com/nurerukun/',
]) {
  if (!top.includes(`href="${url}"`)) errors.push(`トップに道具導線がない: ${url}`);
}

const times = read('times/index.html');
if (!times.includes('<link rel="canonical" href="https://yzrswork.com/times/"')) {
  errors.push('YZRS Timesのcanonicalが不正');
}
for (const path of ['/data/latest.json', '/data/index-manifest.json']) {
  if (!times.includes(path)) errors.push(`YZRS Timesのデータ参照がない: ${path}`);
}

const evening = read('evening.html');
if (!evening.includes('href="/times/?mode=day"')) {
  errors.push('夕刊からYZRS Times一面への導線がない');
}

const expectedAdsTxt = `google.com, ${PUBLISHER}, DIRECT, ${AUTHORITY}\n`;
if (read('ads.txt') !== expectedAdsTxt) errors.push('ads.txtが発行値と一致しない');

const robots = read('robots.txt');
if (!robots.includes('Sitemap: https://yzrswork.com/sitemap.xml')) {
  errors.push('robots.txtにsitemapがない');
}

const sitemap = read('sitemap.xml');
for (const url of [
  'https://yzrswork.com/',
  'https://yzrswork.com/times/',
  'https://yzrswork.com/evening.html',
  'https://yzrswork.com/about/',
  'https://yzrswork.com/privacy/',
]) {
  if (!sitemap.includes(`<loc>${url}</loc>`)) errors.push(`sitemapにURLがない: ${url}`);
}

if (errors.length) {
  console.error(`[check] ${errors.length}件の問題:`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log('[check] OK: ルートポータル、Times互換、6ツール導線、AdSense、信頼ページ、robots、sitemap、HTML内スクリプトを確認。');
