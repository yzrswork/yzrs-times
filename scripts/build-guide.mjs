import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SLUG = 'hajimete-no-denshi-kousaku-starter-guide';
const SOURCE = join(ROOT, 'content', `${SLUG}.md`);
const MANIFEST = join(ROOT, 'content', `${SLUG}.images.yaml`);
const OUTPUT = join(ROOT, 'public', 'guides', SLUG, 'index.html');

const imageFiles = {
  'tools-step1-set': 'tools-step1-set.jpg',
  'tools-step2-set': 'tools-step2-set.jpg',
  'tools-step3-psu': 'tools-step3-psu.jpg',
  'parts-amazon-stock-set': 'parts-amazon-stock-set.png',
  'parts-domestic-stock-set': 'parts-domestic-stock-set.png',
  'parts-china-stock-set': 'parts-china-stock-set.png',
};

const knownHeadingIds = {
  'この記事で分かること': 'overview',
  '結論': 'answer',
  '対象読者': 'audience',
  '作業手順：3ステップで揃える': 'three-steps',
  'STEP1. 部品はどこで買う？': 'step-1',
  'STEP2. 工具は何から揃える？': 'step-2',
  'STEP3. 消耗品と部品ストックは？': 'step-3',
  '確認方法：買う前にここだけ確認': 'check-before-buying',
  '失敗例：買い方でつまずいた話': 'failure-notes',
  '注意点': 'cautions',
  'まとめ': 'summary',
  '次に読む記事': 'next',
};

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderPlain(text) {
  return escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

function linkAttributes(href) {
  if (!/^https?:\/\//.test(href)) return '';
  const host = new URL(href).hostname.toLowerCase();
  if (host === 'amzn.to' || host === 'amazon.co.jp' || host.endsWith('.amazon.co.jp') || host === 'amazon.com' || host.endsWith('.amazon.com')) {
    return ' target="_blank" rel="sponsored nofollow noopener"';
  }
  if (host === 'apps.yzrswork.com') return ' target="_blank" rel="noopener"';
  return ' target="_blank" rel="noopener noreferrer"';
}

function renderInline(text) {
  const pattern = /(\*\*[^*]+\*\*|\[[^\]]+\]\((?:https?:\/\/|\/|#)[^)]+\)|`[^`]+`|https?:\/\/[^\s）)\]]+)/g;
  let html = '';
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    html += renderPlain(text.slice(cursor, match.index));
    const token = match[0];
    if (token.startsWith('**') || token.startsWith('`')) {
      html += renderPlain(token);
    } else if (token.startsWith('[')) {
      const parsed = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      html += parsed
        ? `<a href="${escapeHtml(parsed[2])}"${linkAttributes(parsed[2])}>${renderPlain(parsed[1])}</a>`
        : renderPlain(token);
    } else {
      html += `<a href="${escapeHtml(token)}"${linkAttributes(token)}>${escapeHtml(token)}</a>`;
    }
    cursor = match.index + token.length;
  }
  return html + renderPlain(text.slice(cursor));
}

function splitSource(source) {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  const frontmatter = {};
  if (!match) return { frontmatter, body: source };
  for (const line of match[1].split(/\r?\n/)) {
    const field = line.match(/^([a-z_]+):\s*(.*)$/);
    if (!field) continue;
    frontmatter[field[1]] = field[2].trim().replace(/^"|"$/g, '');
  }
  return { frontmatter, body: source.slice(match[0].length) };
}

function parseManifest(source) {
  const images = [];
  let current = null;
  for (const line of source.split(/\r?\n/)) {
    const id = line.match(/^\s{2}- id:\s*(.+)$/);
    if (id) {
      if (current) images.push(current);
      current = { id: id[1].trim(), source_url: '', alt: '', caption: '', role: '', rights_review: true };
      continue;
    }
    const field = line.match(/^\s{4}([a-z_]+):\s*(.*)$/);
    if (!current || !field) continue;
    let value = field[2].trim();
    if (value.startsWith('"') && value.endsWith('"')) value = JSON.parse(value);
    current[field[1]] = value === 'false' ? false : value === 'true' ? true : value;
  }
  if (current) images.push(current);
  return images;
}

function normalizeBody(body) {
  const output = [];
  let skippingQuoteBlock = false;
  for (const rawLine of body.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    const isQuote = /^>\s?/.test(trimmed);
    if (skippingQuoteBlock) {
      if (isQuote || !trimmed) continue;
      skippingQuoteBlock = false;
    }
    const editorial = /^>?\s*\*\*?要確認\*\*?(?:\s*[:：].*)?$/.test(trimmed) ||
      /^>?\s*Codex実装時の注意(?:点)?\s*[:：]/.test(trimmed) ||
      /^-\s+\*\*?要確認\*\*?(?:\s*[:：].*)?$/.test(trimmed);
    if (editorial) {
      if (isQuote) skippingQuoteBlock = true;
      continue;
    }
    output.push(rawLine
      .replace(/\s*[（(]\s*(?:\*\*)?要確認(?:\*\*)?\s*[:：][^）)]*[）)]/g, '')
      .replace(/\s*\*\*要確認\*\*\s*[:：].*$/g, '')
      .replace(/[ \t]+$/g, ''));
  }
  return output.join('\n');
}

function parseBlocks(rawBody) {
  const lines = normalizeBody(rawBody).split(/\r?\n/);
  const blocks = [];
  let index = 0;
  let headingIndex = 0;
  const special = (line) => /^#{1,4}\s/.test(line) || /^\{\{ image:\s*[^}]+\}\}$/.test(line.trim()) || /^-\s+/.test(line) || /^>\s?/.test(line) || /^---\s*$/.test(line);
  while (index < lines.length) {
    const line = lines[index].trim();
    if (!line) { index += 1; continue; }
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      const text = heading[2].trim();
      if (level !== 1) {
        headingIndex += 1;
        blocks.push({ kind: 'heading', level, text, id: knownHeadingIds[text] || `section-${headingIndex}` });
      }
      index += 1;
      continue;
    }
    const image = line.match(/^\{\{ image:\s*([^}]+)\}\}$/);
    if (image) { blocks.push({ kind: 'image', imageId: image[1].trim() }); index += 1; continue; }
    if (/^---\s*$/.test(line)) { blocks.push({ kind: 'rule' }); index += 1; continue; }
    if (/^-\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^-\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^-\s+/, ''));
        index += 1;
      }
      blocks.push({ kind: 'list', items });
      continue;
    }
    if (/^>\s?/.test(line)) {
      const quote = [];
      while (index < lines.length && /^>\s?/.test(lines[index].trim())) {
        quote.push(lines[index].trim().replace(/^>\s?/, ''));
        index += 1;
      }
      blocks.push({ kind: 'quote', text: quote.join(' ') });
      continue;
    }
    const paragraph = [line];
    index += 1;
    while (index < lines.length && lines[index].trim() && !special(lines[index].trim())) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    blocks.push({ kind: 'paragraph', text: paragraph.join(' ') });
  }
  return blocks;
}

function renderArticle(blocks, images) {
  const imageMap = new Map(images.map((image) => [image.id, image]));
  return blocks.map((block) => {
    if (block.kind === 'heading') {
      const level = Math.min(Math.max(block.level, 2), 4);
      return `<h${level} id="${escapeHtml(block.id)}">${renderInline(block.text)}</h${level}>`;
    }
    if (block.kind === 'paragraph') return `<p>${renderInline(block.text)}</p>`;
    if (block.kind === 'list') return `<ul>${block.items.map((item) => `<li>${renderInline(item)}</li>`).join('')}</ul>`;
    if (block.kind === 'quote') return `<blockquote>${renderInline(block.text)}</blockquote>`;
    if (block.kind === 'rule') return '<hr />';
    const image = imageMap.get(block.imageId);
    if (!image || image.rights_review !== false || !imageFiles[image.id]) throw new Error(`公開不可または不明な画像: ${block.imageId}`);
    return `<figure class="article-figure" data-image-role="${escapeHtml(image.role)}"><img src="/guides/${SLUG}/assets/${imageFiles[image.id]}" alt="${escapeHtml(image.alt)}" loading="lazy" decoding="async" referrerpolicy="no-referrer" /><figcaption>${escapeHtml(image.caption)}</figcaption></figure>`;
  }).join('\n');
}

const { frontmatter, body } = splitSource(readFileSync(SOURCE, 'utf8'));
const images = parseManifest(readFileSync(MANIFEST, 'utf8'));
const blocks = parseBlocks(body);
const toc = blocks.filter((block) => block.kind === 'heading' && (block.level === 2 || block.text.startsWith('STEP')));
const article = renderArticle(blocks, images);

if (images.length !== 6 || images.some((image) => image.rights_review !== false)) throw new Error('画像manifestは権利確認済み6点である必要があります');

const html = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(frontmatter.title)}｜や印工務店</title>
<meta name="description" content="${escapeHtml(frontmatter.description)}" />
<meta name="robots" content="index,follow,max-image-preview:large" />
<meta name="google-adsense-account" content="ca-pub-8467165715973366" />
<meta property="og:type" content="article" />
<meta property="og:locale" content="ja_JP" />
<meta property="og:title" content="${escapeHtml(frontmatter.title)}" />
<meta property="og:description" content="${escapeHtml(frontmatter.description)}" />
<meta property="og:url" content="https://yzrswork.com/guides/${SLUG}/" />
<meta property="og:image" content="https://yzrswork.com/guides/${SLUG}/assets/tools-step1-set.jpg" />
<meta name="twitter:card" content="summary_large_image" />
<link rel="canonical" href="https://yzrswork.com/guides/${SLUG}/" />
<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'Article', headline: frontmatter.title, description: frontmatter.description, image: `https://yzrswork.com/guides/${SLUG}/assets/tools-step1-set.jpg`, author: { '@type': 'Person', name: 'や印工務店', url: 'https://yzrswork.com/about/' }, publisher: { '@type': 'Organization', name: 'や印工務店', url: 'https://yzrswork.com/' }, mainEntityOfPage: `https://yzrswork.com/guides/${SLUG}/`, inLanguage: 'ja' })}</script>
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-8467165715973366" crossorigin="anonymous"></script>
<script src="/analytics.js"></script>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Noto+Sans+JP:wght@400;500;700&display=swap" rel="stylesheet" />
<style>
:root{--paper:#f5f2e9;--paper-deep:#ece6d8;--ink:#1b1f23;--navy:#0e2340;--clay:#b9523d;--muted:#686b6d;--line:#bcb6aa;--sans:"Noto Sans JP","Yu Gothic",sans-serif;--mono:"DM Mono",monospace}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:#dfd8ca;color:var(--ink);font:15px/1.9 var(--sans);-webkit-font-smoothing:antialiased}a{color:var(--navy);text-underline-offset:3px}.skip-link{position:fixed;top:8px;left:8px;z-index:10;padding:8px 12px;background:var(--ink);color:white;transform:translateY(-150%)}.skip-link:focus{transform:none}.page{max-width:1240px;margin:18px auto 42px;background:var(--paper);border:1px solid var(--line);box-shadow:0 2px 32px rgba(30,25,20,.13)}.site-header{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:14px clamp(20px,5vw,64px);border-bottom:1px solid var(--navy);background:var(--paper-deep)}.brand{display:flex;align-items:baseline;gap:10px;color:var(--ink);font-weight:700;text-decoration:none}.brand small{font:12px var(--mono);color:var(--muted)}.site-header nav{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:18px;font-size:13px}.site-header nav a{text-decoration:none}.article-hero{padding:clamp(42px,7vw,86px) clamp(22px,7vw,88px);border-bottom:1px solid var(--navy)}.breadcrumbs{font:11px var(--mono);letter-spacing:.08em}.kicker{margin:30px 0 10px;color:var(--clay);font:500 12px var(--mono);letter-spacing:.12em}.article-hero h1{max-width:920px;margin:0;color:var(--navy);font-size:clamp(34px,6vw,68px);line-height:1.25;letter-spacing:.01em}.dek{max-width:760px;margin:24px 0 0;font-size:17px}.facts{display:flex;flex-wrap:wrap;gap:8px 18px;margin-top:25px;font:12px var(--mono);color:var(--muted)}.layout{display:grid;grid-template-columns:250px minmax(0,760px);justify-content:center;gap:clamp(32px,6vw,76px);padding:50px clamp(22px,6vw,72px) 84px}.toc{position:sticky;top:20px;align-self:start;border-top:3px solid var(--navy);padding-top:14px}.toc>p{margin:0 0 12px;font:500 11px var(--mono);letter-spacing:.14em}.toc nav{display:grid}.toc a{padding:8px 0;border-bottom:1px solid var(--line);font-size:12px;line-height:1.5;text-decoration:none}.toc .tool-link{display:block;margin-top:20px;padding:14px;border:1px solid var(--clay);color:var(--clay);font-weight:700;text-decoration:none}.origin{margin-bottom:42px;padding:20px;border-left:4px solid var(--clay);background:var(--paper-deep)}.origin p{margin:0}.origin p+p{margin-top:8px}.article-body h2{margin:76px 0 20px;padding:10px 0;border-top:3px solid var(--navy);border-bottom:1px solid var(--line);color:var(--navy);font-size:clamp(24px,4vw,34px);line-height:1.45}.article-body h3{margin:54px 0 18px;color:var(--navy);font-size:23px;line-height:1.5}.article-body h4{margin:32px 0 12px;font-size:18px}.article-body p{margin:0 0 22px}.article-body ul{margin:0 0 25px;padding-left:1.4em}.article-body li+li{margin-top:8px}.article-body blockquote{margin:28px 0;padding:18px 22px;border-left:4px solid var(--clay);background:#eee6d7;font-weight:500}.article-body hr{margin:54px 0;border:0;border-top:1px solid var(--line)}.article-body code{padding:1px 5px;background:var(--paper-deep);font:13px var(--mono)}.article-figure{margin:34px 0 48px}.article-figure img{display:block;width:100%;height:auto;border:1px solid var(--line);background:#fff}.article-figure figcaption{padding:9px 0;border-bottom:1px solid var(--line);color:var(--muted);font-size:12px}.affiliate{margin-top:70px;padding:24px;border:1px solid var(--line);background:var(--paper-deep)}.affiliate h2{margin:0 0 10px;font:500 13px var(--mono);letter-spacing:.1em}.affiliate p{margin:7px 0;font-size:13px}.site-footer{display:grid;grid-template-columns:1fr auto;gap:28px;padding:34px clamp(22px,6vw,72px);border-top:1px solid var(--navy);background:var(--paper-deep)}.footer-links{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:16px;font-size:13px}.site-footer p{margin:4px 0}.site-footer small{font:11px var(--mono);color:var(--muted)}@media(max-width:840px){.site-header{align-items:flex-start;flex-direction:column}.site-header nav{justify-content:flex-start}.layout{grid-template-columns:1fr}.toc{position:static}.toc nav{grid-template-columns:repeat(2,minmax(0,1fr));gap:0 14px}.site-footer{grid-template-columns:1fr}.footer-links{justify-content:flex-start}}@media(max-width:540px){.page{margin:0}.toc nav{grid-template-columns:1fr}.article-hero h1{font-size:34px}}@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
</style>
</head>
<body>
<a class="skip-link" href="#article-content">本文へ移動</a>
<div class="page">
<header class="site-header"><a class="brand" href="/"><span>や印工務店</span><small>yzrswork</small></a><nav aria-label="主要ナビゲーション"><a href="/#bench-electronics">電子工作</a><a href="/#bench-pc">自作PC</a><a href="/#bench-diy">DIY・模型</a><a href="/#guides">Guide</a><a href="https://apps.yzrswork.com/">道具箱</a><a href="/times/">YZRS Times</a></nav></header>
<main>
<section class="article-hero"><nav class="breadcrumbs" aria-label="パンくず"><a href="/">や印工務店</a> ／ <a href="/#guides">Guide 01</a> ／ スターターガイド</nav><p class="kicker">GUIDE 01 ／ ELECTRONICS — BEGINNER</p><h1>はじめての電子工作<br />スターターガイド</h1><p class="dek">部品はどこで買う？ 工具は何から？ 消耗品はどこまで必要？<br />最初の買い物を、実際に揃える順番でひとつにまとめました。</p><div class="facts"><span>● はじめて</span><span>約${escapeHtml(frontmatter.estimated_minutes)}分</span><span>3記事を再編集</span><span>失敗例あり</span></div></section>
<div class="layout"><aside class="toc" aria-label="この記事の目次"><p>CONTENTS</p><nav>${toc.map((item) => `<a href="#${escapeHtml(item.id)}">${escapeHtml(item.text)}</a>`).join('')}</nav><a class="tool-link" href="https://apps.yzrswork.com/kit/" target="_blank" rel="noopener">装備ナビで確認する →</a></aside><div><div class="origin"><p><strong>3本のnote記事を、1本のGuideへ。</strong></p><p>部品調達・工具・消耗品ストックの記事を、初めて買う人の行動順に再編集しています。</p></div><article class="article-body" id="article-content">${article}</article><aside class="affiliate" id="affiliate-disclosure"><h2>Amazonアソシエイトについて</h2><p>この記事にはAmazonアソシエイトのアフィリエイトリンクを含みます。リンク経由の購入により、や印工務店が紹介料を受け取る場合があります。Amazonのアソシエイトとして、や印工務店は適格販売により収入を得ています。</p><p>価格・在庫・型番・販売元は購入時にリンク先で確認してください。</p></aside></div></div>
</main>
<footer class="site-footer"><div><strong>や印工務店</strong><p>作る。直す。測って確かめる。</p><small>© や印工務店 ／ 記事内容と購入条件は公開時点の情報です。</small></div><nav class="footer-links" aria-label="フッター"><a href="/">工房トップ</a><a href="/about/">工房案内</a><a href="/privacy/">プライバシー</a><a href="https://forms.gle/y3zyPFtuNh8qpj18A">問い合わせ</a><a href="/about/#advertising">広告・Amazon関連表記</a></nav></footer>
</div>
</body>
</html>
`;

writeFileSync(OUTPUT, html, 'utf8');
console.log(`[build:guide] ${OUTPUT}`);
