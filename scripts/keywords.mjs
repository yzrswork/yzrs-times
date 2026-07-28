// キーワード品質の正。生成側（edit.mjs / editorial-helpers.mjs）と
// 派生側（build-graph.mjs）の両方がここを使い、判定のズレを防ぐ。
//
// 背景（2026-07-26の実測）: 夕刊グラフの絡まりの26%が「Show HN」プレフィックスの残骸、
// STOPWORDS漏れ、日本語タイトル断片（括弧混入）が作る偽の構造だった。

// タイトル分割由来のキーワードから接続語、汎用語を除く（en）。
// 日本語はフレーズ塊で来るため対象外（断片はFRAGMENT_CHARSで弾く）。
export const STOPWORDS = new Set([
  // 冠詞、前置詞、接続詞
  'the', 'a', 'an', 'and', 'or', 'but', 'for', 'nor', 'with', 'from', 'into', 'onto',
  'on', 'in', 'to', 'of', 'at', 'by', 'as', 'up', 'out', 'off', 'over', 'under',
  'about', 'after', 'before', 'between', 'without', 'against', 'during', 'while',
  'per', 'via', 'vs',
  // 代名詞、限定詞
  'that', 'this', 'these', 'those', 'you', 'your', 'yours', 'our', 'ours', 'it', 'its',
  'his', 'her', 'their', 'they', 'them', 'what', 'when', 'where', 'why', 'how',
  'who', 'which', 'my', 'me', 'we', 'us', 'he', 'she', 'all', 'any', 'some', 'other',
  'own', 'each', 'both', 'few', 'more', 'most', 'less', 'least', 'much', 'many',
  // be動詞、助動詞、汎用動詞
  'are', 'is', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
  'will', 'would', 'can', 'could', 'should', 'do', 'does', 'did', 'done',
  'get', 'gets', 'got', 'make', 'makes', 'made', 'making', 'use', 'using', 'used',
  'say', 'says', 'said', 'built', 'build', 'building', 'works', 'working',
  // 副詞、その他機能語
  'not', 'no', 'yes', 'very', 'just', 'now', 'new', 'like', 'than', 'then', 'there',
  'here', 'so', 'if', 'also', 'only', 'even', 'ever', 'never', 'again', 'once',
  'still', 'back', 'top', 'first', 'one', 'two', 'don', 'dont', 'doesn', 'isn',
  'running', 'good', 'open', 'free', 'way', 'ways', 'thing', 'things',
  // HN投稿プレフィックスの残骸
  'show', 'ask', 'tell', 'launch', 'hn',
]);

// カテゴリIDと同名のキーワードは情報が重複する（カテゴリ結線が既にある）ため除く。
export const CATEGORY_IDS = new Set(['news', 'tech', 'programming', 'oss', 'blog', 'trends', 'general']);

// 先頭、末尾の飾りを剥がす対象
const TRIM_CHARS = /^[\s"'“”‘’「」『』()（）\[\]【】{}<>《》.,!?！？:;、。・･…—–-]+|[\s"'“”‘’「」『』()（）\[\]【】{}<>《》.,!?！？:;、。・･…—–-]+$/gu;
// 剥がした後もなお残る括弧、引用符は「タイトルの断片」の証拠（キーワードは括弧を含まない）
const FRAGMENT_CHARS = /[「」『』()（）\[\]【】{}<>《》"“”]/;

// HN系タイトルの投稿プレフィックスを除く（キーワード抽出前のタイトル整形用）
export function stripPostPrefix(title) {
  return (title || '').replace(/^\s*(show|ask|tell|launch)\s+hn\s*[:：]?\s*/i, '');
}

// キーワード1語を検査、整形する。不合格ならnull。表記（大文字小文字）は保存する。
export function cleanKeyword(raw) {
  const k = String(raw ?? '').replace(TRIM_CHARS, '').trim();
  if (k.length < 2 || k.length > 20) return null;
  if (FRAGMENT_CHARS.test(k)) return null; // 括弧混入 = タイトル断片
  if (!/\p{L}/u.test(k)) return null; // 文字を含まない（数字、記号のみ）は捨てる
  if (/を$/.test(k)) return null; // 助詞「を」で終わる日本語はタイトル断片
  const lower = k.toLowerCase();
  if (STOPWORDS.has(lower)) return null;
  if (CATEGORY_IDS.has(lower)) return null;
  return k;
}

// 配列をまとめて整形する（重複は小文字基準で除去し、最初の表記を残す）
export function cleanKeywords(list, limit = 5) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(list) ? list : []) {
    const k = cleanKeyword(raw);
    if (!k) continue;
    const key = k.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(k);
    if (out.length >= limit) break;
  }
  return out;
}
