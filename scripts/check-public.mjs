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

const contentPages = ['index.html', 'evening.html'];
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
  for (const match of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\ssrc\s*=/.test(match[1])) continue;
    try {
      new vm.Script(match[2], { filename: page });
    } catch (error) {
      errors.push(`インラインJavaScript構文エラー: ${page}: ${error.message}`);
    }
  }
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

console.log('[check] OK: AdSense確認、信頼ページ、robots、sitemap、HTML内スクリプトを確認。');
