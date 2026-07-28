// 縮刷版アーカイブ（public/data/issues/ の全号）から夕刊（探索モード）用の
// グラフデータ public/data/graph.json を導出する。
// 号JSONが正典、graph.jsonは再生成可能な派生物（README データ契約）。AIは使わない。
//
// schemaVersion 2（夕刊2.0）: issues[] と articles[] の2配列のみ。
// 記事はURL正規化で全号横断の重複を1点に束ね、掲載号を article.issues[] に持つ。
// キーワード索引とカテゴリ集計は夕刊がクライアント側で導出する（エッジ配列は持たない）。
// 号同士の時系列鎖（旧seqエッジ）は廃止 -- X軸が時間を表すため情報が重複する（DESIGN.md 2026-07-28）。
import fs from 'node:fs';
import path from 'node:path';
import { ISSUES_DIR, PUBLIC_DATA_DIR } from './store.mjs';
import { normalizeUrl } from './util.mjs';
import { cleanKeyword } from './keywords.mjs';

const GRAPH_FILE = path.join(PUBLIC_DATA_DIR, 'graph.json');
const EDITION_ORDER = { morning: 0, midday: 1, evening: 2 };

// キーワード品質の正は keywords.mjs（生成側と同じ判定）。グラフ側はハブ統合のため小文字に寄せる。
// 既発行号に残る旧ノイズ（Show HN断片、機能語、括弧混入）もここで遡及的に除去される。
function normalizeKeyword(raw) {
  const k = cleanKeyword(raw);
  return k ? k.toLowerCase() : null;
}

function listIssueFiles() {
  if (!fs.existsSync(ISSUES_DIR)) return [];
  return fs
    .readdirSync(ISSUES_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const m = f.match(/^(\d{4}-\d{2}-\d{2})-(\w+)\.json$/);
      return m ? { file: f, date: m[1], edition: m[2] } : null;
    })
    .filter(Boolean)
    .sort((a, b) =>
      a.date === b.date
        ? (EDITION_ORDER[a.edition] ?? 9) - (EDITION_ORDER[b.edition] ?? 9)
        : a.date.localeCompare(b.date),
    );
}

export function buildGraph() {
  const issues = [];
  const articleByUrl = new Map(); // normalizedUrl -> article
  const keywordSpan = new Map(); // keyword -> Set(issueId)（counts用）

  for (const meta of listIssueFiles()) {
    let issue;
    try {
      issue = JSON.parse(fs.readFileSync(path.join(ISSUES_DIR, meta.file), 'utf8'));
    } catch {
      continue; // 壊れた号があっても他の号でグラフは成立させる（fail-soft）
    }

    const issueId = `i:${meta.date}-${meta.edition}`;
    issues.push({
      id: issueId,
      date: meta.date,
      edition: meta.edition,
      issueNo: issue.issueNo,
      theme: issue.theme?.title ?? null,
      themeNote: issue.theme?.note ?? null,
    });

    const articles = [...(issue.articles ?? [])];
    if (issue.hiddenGem?.article) articles.push({ ...issue.hiddenGem.article, gem: true });

    for (const a of articles) {
      if (!a?.url || !a?.title) continue;
      const urlKey = normalizeUrl(a.url);
      let node = articleByUrl.get(urlKey);
      if (!node) {
        const kws = [...new Set((a.keywords ?? []).map(normalizeKeyword).filter(Boolean))];
        node = {
          id: `a:${urlKey}`,
          title: a.title,
          url: a.url,
          category: a.category || 'general',
          date: meta.date,
          source: a.source ?? null,
          temperature: a.heat?.temperature ?? null,
          summaryJa: Array.isArray(a.summaryJa) ? a.summaryJa : [],
          gem: Boolean(a.gem),
          keywords: kws,
          issues: [],
        };
        articleByUrl.set(urlKey, node);
      }
      if (a.gem) node.gem = true;
      if (!node.issues.includes(issueId)) node.issues.push(issueId);
      for (const kw of node.keywords) {
        if (!keywordSpan.has(kw)) keywordSpan.set(kw, new Set());
        keywordSpan.get(kw).add(issueId);
      }
    }
  }

  const articles = [...articleByUrl.values()];
  const categories = new Set(articles.map((a) => a.category));

  return {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    counts: {
      issues: issues.length,
      articles: articles.length,
      // 2記事以上で共起する語（クライアント導出と同じ基準の参考値）
      keywords: [...keywordSpan.keys()].filter(
        (kw) => articles.filter((a) => a.keywords.includes(kw)).length >= 2,
      ).length,
      categories: categories.size,
    },
    issues,
    articles,
  };
}

const graph = buildGraph();
fs.mkdirSync(PUBLIC_DATA_DIR, { recursive: true });
fs.writeFileSync(GRAPH_FILE, JSON.stringify(graph), 'utf8');
console.log(
  `graph.json を再生成 (schema v2): 号${graph.counts.issues} 記事${graph.counts.articles} キーワード${graph.counts.keywords} カテゴリ${graph.counts.categories}`,
);
