// 縮刷版アーカイブ（public/data/issues/ の全号）から夕刊（探索モード）用の
// グラフデータ public/data/graph.json を導出する。
// 号JSONが正典・graph.jsonは再生成可能な派生物（README データ契約）。AIは使わない。
//
// ノード4種: issue（号）/ article（記事）/ keyword（共起キーワード）/ category（カテゴリ）
// エッジ4種: pub（号-記事）/ kw（記事-キーワード）/ cat（記事-カテゴリ）/ seq（号-号 時系列）
// 記事はURL正規化で全号横断の重複を1ノードに束ねる（朝刊と昼刊に同じ話題が載っても1点）。
import fs from 'node:fs';
import path from 'node:path';
import { ISSUES_DIR, PUBLIC_DATA_DIR } from './store.mjs';
import { normalizeUrl } from './util.mjs';

const GRAPH_FILE = path.join(PUBLIC_DATA_DIR, 'graph.json');
const EDITION_ORDER = { morning: 0, midday: 1, evening: 2 };
const EDITION_LABEL = { morning: '朝刊', midday: '昼刊', evening: '夕刊' };

// タイトル分割由来のキーワードから接続語を除く（en最小セット。日本語はフレーズ塊で来るため対象外）
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'for', 'nor', 'with', 'from', 'into', 'onto',
  'that', 'this', 'these', 'those', 'are', 'is', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'not', 'no', 'yes', 'you', 'your', 'yours', 'our', 'ours',
  'its', 'his', 'her', 'their', 'they', 'them', 'what', 'when', 'where', 'why', 'how',
  'who', 'which', 'will', 'would', 'can', 'could', 'should', 'about', 'over', 'under',
  'more', 'most', 'less', 'least', 'very', 'just', 'now', 'new', 'via', 'using', 'use',
  'like', 'than', 'then', 'there', 'here', 'out', 'off', 'own', 'all', 'any', 'some',
  'other', 'after', 'before', 'between', 'without', 'don', 'dont', 'doesn', 'isn', 'ask',
]);

function normalizeKeyword(raw) {
  const k = (raw || '')
    .trim()
    .replace(/^[\s"'“”‘’「」『』()（）\[\]【】<>《》.,!?！？:;…]+/, '')
    .replace(/[\s"'“”‘’「」『』()（）\[\]【】<>《》.,!?！？:;…]+$/, '')
    .toLowerCase();
  if (k.length < 2 || k.length > 20) return null;
  if (!/\p{L}/u.test(k)) return null; // 文字を含まない（数字・記号のみ）は捨てる
  if (STOPWORDS.has(k)) return null;
  return k;
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
  const nodes = [];
  const edges = [];
  const articleByUrl = new Map(); // normalizedUrl -> article node
  const keywordToArticles = new Map(); // keyword -> Set(articleNodeId)
  const categoryToArticles = new Map(); // category -> Set(articleNodeId)
  const issueNodeIds = [];

  for (const meta of listIssueFiles()) {
    let issue;
    try {
      issue = JSON.parse(fs.readFileSync(path.join(ISSUES_DIR, meta.file), 'utf8'));
    } catch {
      continue; // 壊れた号があっても他の号でグラフは成立させる（fail-soft）
    }

    const issueId = `i:${meta.date}-${meta.edition}`;
    nodes.push({
      id: issueId,
      type: 'issue',
      label: `#${issue.issueNo} ${EDITION_LABEL[meta.edition] ?? meta.edition}`,
      date: meta.date,
      edition: meta.edition,
      issueNo: issue.issueNo,
      theme: issue.theme?.title ?? null,
    });
    issueNodeIds.push(issueId);

    const articles = [...(issue.articles ?? [])];
    if (issue.hiddenGem?.article) articles.push({ ...issue.hiddenGem.article, gem: true });

    for (const a of articles) {
      if (!a?.url || !a?.title) continue;
      const urlKey = normalizeUrl(a.url);
      let node = articleByUrl.get(urlKey);
      if (!node) {
        node = {
          id: `a:${urlKey}`,
          type: 'article',
          label: a.title,
          url: a.url,
          category: a.category || 'general',
          date: meta.date,
          source: a.source ?? null,
          temperature: a.heat?.temperature ?? null,
          summaryJa: Array.isArray(a.summaryJa) ? a.summaryJa : [],
          gem: Boolean(a.gem),
          keywords: [],
        };
        articleByUrl.set(urlKey, node);
        nodes.push(node);

        const kws = new Set((a.keywords ?? []).map(normalizeKeyword).filter(Boolean));
        node.keywords = [...kws];
        for (const kw of kws) {
          if (!keywordToArticles.has(kw)) keywordToArticles.set(kw, new Set());
          keywordToArticles.get(kw).add(node.id);
        }
        const cat = node.category;
        if (!categoryToArticles.has(cat)) categoryToArticles.set(cat, new Set());
        categoryToArticles.get(cat).add(node.id);
      }
      edges.push({ s: issueId, t: node.id, type: 'pub' });
    }
  }

  // 号の時系列チェーン（縮刷版の背表紙）
  for (let i = 1; i < issueNodeIds.length; i++) {
    edges.push({ s: issueNodeIds[i - 1], t: issueNodeIds[i], type: 'seq' });
  }

  // 2記事以上で共起したキーワードだけをハブノード化する（1記事だけの語は結線を生まない）
  for (const [kw, arts] of keywordToArticles) {
    if (arts.size < 2) continue;
    const kwId = `k:${kw}`;
    nodes.push({ id: kwId, type: 'keyword', label: kw, count: arts.size });
    for (const aid of arts) edges.push({ s: kwId, t: aid, type: 'kw' });
  }

  // カテゴリはタグとして常設（記事が必ずどこかの島に属するようにする）
  for (const [cat, arts] of categoryToArticles) {
    const catId = `c:${cat}`;
    nodes.push({ id: catId, type: 'category', label: cat, count: arts.size });
    for (const aid of arts) edges.push({ s: catId, t: aid, type: 'cat' });
  }

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    counts: {
      issues: issueNodeIds.length,
      articles: articleByUrl.size,
      keywords: [...keywordToArticles.values()].filter((s) => s.size >= 2).length,
      categories: categoryToArticles.size,
      edges: edges.length,
    },
    nodes,
    edges,
  };
}

const graph = buildGraph();
fs.mkdirSync(PUBLIC_DATA_DIR, { recursive: true });
fs.writeFileSync(GRAPH_FILE, JSON.stringify(graph), 'utf8');
console.log(
  `graph.json を再生成: 号${graph.counts.issues} 記事${graph.counts.articles} キーワード${graph.counts.keywords} カテゴリ${graph.counts.categories} エッジ${graph.counts.edges}`,
);
