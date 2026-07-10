// 決定論的モックプロバイダ。ネットワーク不要。dry-runとCI検証用。
// 候補から温度と多様性で選び、snippetから機械的に3行を組み立てる。
import { summarizeFromSnippet, deriveCategory } from '../editorial-helpers.mjs';

const THEME_BY_CATEGORY = {
  news: { title: '今日のニュース', note: '時事の話題を中心にお届けします。' },
  tech: { title: '静かな技術', note: '手を動かす人たちの話題が目立った一日でした。' },
  programming: { title: '開発者たちの一日', note: '開発・ツール周りの話題が豊作でした。' },
  trends: { title: '今、話題のこと', note: '今日の関心事をまとめました。' },
  general: { title: '編集部より', note: '本日の紙面をお届けします。' },
};

export async function generate(promptCtx, ctx) {
  const { candidates, gemCandidates, editionConfig } = ctx;

  const top = candidates
    .slice()
    .sort((a, b) => b.heat.temperature - a.heat.temperature)
    .slice(0, editionConfig.topCount)
    .map((c) => c.id);
  const usedIds = new Set(top);

  const sections = editionConfig.sections.map((section) => {
    const picked = candidates
      .filter((c) => section.sources.includes(c.sourceId) && !usedIds.has(c.id))
      .sort((a, b) => b.heat.temperature - a.heat.temperature)
      .slice(0, section.max);
    picked.forEach((c) => usedIds.add(c.id));
    return { id: section.id, articleIds: picked.map((c) => c.id) };
  });

  const byId = new Map([...candidates, ...gemCandidates].map((c) => [c.id, c]));
  const allSelectedIds = [...top, ...sections.flatMap((s) => s.articleIds)];

  const summaries = {};
  const categories = {};
  for (const id of allSelectedIds) {
    const item = byId.get(id);
    summaries[id] = summarizeFromSnippet(item);
    categories[id] = deriveCategory(item);
  }

  const gem = gemCandidates.slice().sort((a, b) => b.heat.temperature - a.heat.temperature)[0];
  const hiddenGem = gem
    ? { id: gem.id, reason: `${gem.source}発の小さな試み「${gem.title}」。有名になる前の道具にはまだ余白があります。` }
    : null;
  if (gem) categories[gem.id] = deriveCategory(gem);

  const topArticle = byId.get(top[0]);
  const theme = topArticle ? (THEME_BY_CATEGORY[categories[top[0]]?.category] ?? THEME_BY_CATEGORY.general) : THEME_BY_CATEGORY.general;

  const output = {
    theme,
    top,
    sections,
    summaries,
    editorial: {
      comment: topArticle
        ? `本日の一面は「${topArticle.title}」です。候補全体の温度分布から見て、今日は落ち着いた一日でした。`
        : '本日は目立った候補がありませんでした。',
      passedOver: '重複や関連性の薄い話題は今日は見送りました。',
    },
    hiddenGem,
    categories,
  };

  return { output, model: 'mock' };
}
