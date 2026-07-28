// edit.mjsとproviders/mock.mjsの両方から使う小さな純関数群（循環import回避のため分離）。
import { stripPostPrefix, cleanKeywords } from './keywords.mjs';

const CATEGORY_BY_SOURCE = {
  'nhk-top': 'news', 'nhk-world': 'news', 'yahoo-topics': 'news',
  'hn-front': 'tech', 'hatebu-it': 'programming', 'gtrends-jp': 'trends',
  'show-hn': 'tech', 'github-gems': 'oss', 'indieblog': 'blog',
  'zenn-trend': 'programming', 'qiita-popular': 'programming', 'lobsters': 'tech',
};

// snippetを整形して要約代わりの3行を機械的に組み立てる（フォールバック・mock用）。
export function summarizeFromSnippet(item) {
  const snippet = (item.snippet || '').trim();
  const sentences = snippet
    .split(/(?<=[。！？.!?])\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  const lines = [];
  if (sentences.length > 0) lines.push(...sentences.slice(0, 3));
  while (lines.length < 3) {
    if (lines.length === 0) lines.push(item.title.slice(0, 50));
    else if (lines.length === 1) lines.push(`出典: ${item.source}`);
    else lines.push('詳細は元記事を参照してください。');
  }
  return lines.slice(0, 3).map((l) => l.slice(0, 80));
}

export function deriveCategory(item) {
  const category = CATEGORY_BY_SOURCE[item.sourceId] ?? 'general';
  const keywords = cleanKeywords(tokenizeTitle(item.title), 5);
  return { category, keywords: keywords.length > 0 ? keywords : [category] };
}

function tokenizeTitle(title) {
  return stripPostPrefix(title || '')
    .split(/[\s\-:—|,、。・"'“”「」『』()（）\[\]【】]+/)
    .map((t) => t.trim())
    // ひらがな始まりは助詞ごと切れた断片（「の落とし穴について」等）。機械分割の限界なので捨てる。
    // 編集AI経路のキーワードには適用しない（「ものづくり」のような語はそちらでは正当）。
    .filter((t) => t && !/^[぀-ゟ]/.test(t))
    .slice(0, 12);
}
