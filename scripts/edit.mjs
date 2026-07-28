// LLM編集ステップ。プロンプト組み立て（純関数）とプロバイダ呼び出し・検証・フォールバックを担当。
// README憲法6番：LLMは候補IDだけを参照する。URL・価格・日付はここでシステム側が結合する。
import * as gemini from './providers/gemini.mjs';
import * as mock from './providers/mock.mjs';
import { summarizeFromSnippet, deriveCategory } from './editorial-helpers.mjs';
import { cleanKeywords } from './keywords.mjs';
import { urlCacheKey, setSummaryCache } from './store.mjs';

const PROVIDERS = { gemini, mock };

// 編集AIの出力が使えなかったときの題。毎回同じ文字列になるため重複検出からは除外する。
const FALLBACK_THEME_TITLE = '編集部より';

// --- プロンプト組み立て（純関数） ---
export function toCandidateView(item, maxSnippetChars) {
  return {
    id: item.id,
    title: item.title,
    source: item.source,
    snippet: (item.snippet || '').slice(0, maxSnippetChars),
    heat: item.heat.temperature,
    lang: item.lang,
  };
}

export function buildPromptContext({ editorPromptTemplate, candidates, gemCandidates, editionConfig, prevIssue, recentThemes = [], maxSnippetChars, summaryCache }) {
  const withCacheFlag = (c) => {
    const view = toCandidateView(c, maxSnippetChars);
    const cached = summaryCache?.entries?.[urlCacheKey(c.url)];
    if (cached?.summaryJa) {
      view.cachedSummaryAvailable = true; // 要約済み。summariesにこのidを含めなくてよい
    }
    return view;
  };
  const candidateViews = candidates.map(withCacheFlag);
  const gemViews = gemCandidates.map(withCacheFlag);
  const sectionsInfo = editionConfig.sections.map((s) => ({ id: s.id, title: s.title, max: s.max, sources: s.sources }));
  const prevContext = prevIssue
    ? { theme: prevIssue.theme?.title ?? null, editorialComment: prevIssue.editorial?.comment ?? null }
    : null;

  const promptText = [
    editorPromptTemplate.trim(),
    '',
    '## 版構成',
    JSON.stringify({ edition: editionConfig.edition, topCount: editionConfig.topCount, maxArticlesTotal: editionConfig.maxArticlesTotal, sections: sectionsInfo }, null, 2),
    '',
    '## 前号の文脈',
    prevContext ? JSON.stringify(prevContext, null, 2) : '（前号なし・創刊号です）',
    '',
    '## 最近のテーマ（この題は再利用しない）',
    recentThemes.length
      ? JSON.stringify(recentThemes.map((t) => t.theme), null, 2)
      : '（まだありません）',
    '',
    '## 候補記事（これ以外のIDは存在しません）',
    JSON.stringify(candidateViews, null, 2),
    '',
    '## Hidden Gem候補',
    JSON.stringify(gemViews, null, 2),
    '',
    '## 出力してください',
    '次のJSONスキーマに厳密に従い、JSONのみを出力してください（前後に説明文を書かない）:',
    '{"theme":{"title":string,"note":string},"top":[id,...],"sections":[{"id":string,"articleIds":[id,...]}],"summaries":{"id":[string,string,string]},"editorial":{"comment":string,"passedOver":string},"hiddenGem":{"id":string,"reason":string},"categories":{"id":{"category":string,"keywords":[string,...]}}}',
  ].join('\n');

  return { promptText, candidateViews, gemViews, sectionsInfo, prevContext, recentThemes };
}

// 題の使い回しは紙面を壊さないので発行は止めない。気づけるようにログにだけ残す
// （直近テーマをプロンプトへ渡すようになった後も繰り返すなら、指示側の作り直しが要る）。
// フォールバックの題は必ず過去と一致するが、それは編集AIの失敗として別に記録済みなので対象外。
export function findThemeRepeat(title, recentThemes = []) {
  const norm = (s) => String(s ?? '').trim().toLowerCase();
  const t = norm(title);
  if (!t || t === norm(FALLBACK_THEME_TITLE)) return null;
  for (const r of recentThemes) {
    const past = norm(r.theme);
    if (!past) continue;
    if (past === t || past.includes(t) || t.includes(past)) return r;
  }
  return null;
}

// --- 検証と修復（フィールド単位でフォールバック） ---
function isValidId(id, pool) {
  return typeof id === 'string' && pool.has(id);
}

function validateTop(raw, candidatePool, topCount) {
  if (!Array.isArray(raw)) return null;
  const ids = [...new Set(raw.filter((id) => isValidId(id, candidatePool)))].slice(0, topCount);
  return ids.length > 0 ? ids : null;
}

// raw全体が使い物にならなければnull（呼び出し元がdefaultSectionsに全面フォールバック）。
// raw自体は妥当だが一部のセクションが欠けている場合は、そのセクションだけ温度順で補う
// （版構成は常に全セクションが揃っている必要があるため）。
function validateSections(raw, candidatePool, editionConfig, usedIds, candidates) {
  if (!Array.isArray(raw)) return null;
  const sectionDefs = new Map(editionConfig.sections.map((s) => [s.id, s]));
  const out = new Map();
  for (const s of raw) {
    if (!s || typeof s.id !== 'string' || !sectionDefs.has(s.id) || out.has(s.id) || !Array.isArray(s.articleIds)) continue;
    const max = sectionDefs.get(s.id).max;
    const ids = [];
    for (const id of s.articleIds) {
      if (!isValidId(id, candidatePool) || usedIds.has(id) || ids.includes(id)) continue;
      ids.push(id);
      if (ids.length >= max) break;
    }
    out.set(s.id, { id: s.id, title: sectionDefs.get(s.id).title, articleIds: ids });
    ids.forEach((id) => usedIds.add(id));
  }
  if (out.size === 0) return null;

  for (const section of editionConfig.sections) {
    if (out.has(section.id)) continue;
    const picked = candidates
      .filter((c) => section.sources.includes(c.sourceId) && !usedIds.has(c.id))
      .sort((a, b) => b.heat.temperature - a.heat.temperature)
      .slice(0, section.max);
    picked.forEach((c) => usedIds.add(c.id));
    out.set(section.id, { id: section.id, title: section.title, articleIds: picked.map((c) => c.id) });
  }
  return editionConfig.sections.map((s) => out.get(s.id));
}

function validateSummaries(raw, ids) {
  const out = {};
  if (raw && typeof raw === 'object') {
    for (const id of ids) {
      const v = raw[id];
      if (Array.isArray(v) && v.length === 3 && v.every((l) => typeof l === 'string' && l.trim().length > 0)) {
        out[id] = v.map((l) => l.trim());
      }
    }
  }
  return out;
}

function validateEditorial(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const { comment, passedOver } = raw;
  if (typeof comment !== 'string' || comment.trim().length === 0) return null;
  return {
    comment: comment.trim(),
    passedOver: typeof passedOver === 'string' && passedOver.trim() ? passedOver.trim() : '本日は見送るほどの候補の偏りはありませんでした。',
    signature: '—— YZRS Times 編集長',
  };
}

function validateHiddenGem(raw, gemCandidatePool) {
  if (!raw || typeof raw !== 'object') return null;
  if (!isValidId(raw.id, gemCandidatePool)) return null;
  if (typeof raw.reason !== 'string' || raw.reason.trim().length === 0) return null;
  return { id: raw.id, reason: raw.reason.trim() };
}

function validateCategories(raw, ids) {
  const out = {};
  if (raw && typeof raw === 'object') {
    for (const id of ids) {
      const v = raw[id];
      if (v && typeof v.category === 'string' && Array.isArray(v.keywords)) {
        // 編集AI由来のキーワードも品質フィルタを通す（タイトル断片、機能語、括弧混入を発行前に落とす）
        out[id] = { category: v.category.trim(), keywords: cleanKeywords(v.keywords, 5) };
      }
    }
  }
  return out;
}

// LLM出力を検証し、壊れたフィールドだけシステム側の妥当値で埋める。
function validateAndRepair(raw, { candidates, gemCandidates, editionConfig }) {
  if (!raw || typeof raw !== 'object') return null;
  const candidatePool = new Set(candidates.map((c) => c.id));
  const gemCandidatePool = new Set(gemCandidates.map((c) => c.id));
  const byId = new Map([...candidates, ...gemCandidates].map((c) => [c.id, c]));

  const top = validateTop(raw.top, candidatePool, editionConfig.topCount) ?? defaultTop(candidates, editionConfig.topCount);
  const usedIds = new Set(top);
  const sections = validateSections(raw.sections, candidatePool, editionConfig, usedIds, candidates)
    ?? defaultSections(candidates, editionConfig, usedIds);

  const allSelectedIds = [...top, ...sections.flatMap((s) => s.articleIds)];
  const summaries = validateSummaries(raw.summaries, allSelectedIds);
  const categories = validateCategories(raw.categories, allSelectedIds);
  const theme = validateTheme(raw.theme);
  const editorial = validateEditorial(raw.editorial) ?? defaultEditorial(byId.get(top[0]));
  const hiddenGem = validateHiddenGem(raw.hiddenGem, gemCandidatePool) ?? defaultHiddenGem(gemCandidates);

  return { theme, top, sections, summaries, editorial, hiddenGem, categories, byId };
}

function validateTheme(raw) {
  if (raw && typeof raw.title === 'string' && raw.title.trim() && typeof raw.note === 'string' && raw.note.trim()) {
    return { title: raw.title.trim(), note: raw.note.trim() };
  }
  return { title: FALLBACK_THEME_TITLE, note: '本日の紙面をお届けします。' };
}

function defaultTop(candidates, topCount) {
  return candidates.slice().sort((a, b) => b.heat.temperature - a.heat.temperature).slice(0, topCount).map((c) => c.id);
}

function defaultSections(candidates, editionConfig, usedIds) {
  return editionConfig.sections.map((section) => {
    const picked = candidates
      .filter((c) => section.sources.includes(c.sourceId) && !usedIds.has(c.id))
      .sort((a, b) => b.heat.temperature - a.heat.temperature)
      .slice(0, section.max);
    picked.forEach((c) => usedIds.add(c.id));
    return { id: section.id, title: section.title, articleIds: picked.map((c) => c.id) };
  });
}

function defaultEditorial(topArticle) {
  const mention = topArticle ? `本日の一面は「${topArticle.title}」です。` : '本日は静かな一日でした。';
  return {
    comment: `${mention}自動編成にて紙面をお届けします。`,
    passedOver: '本日は見送り記事の選定を行っていません。',
    signature: '—— YZRS Times 編集長',
  };
}

function defaultHiddenGem(gemCandidates) {
  const top = gemCandidates.slice().sort((a, b) => b.heat.temperature - a.heat.temperature)[0];
  if (!top) return null;
  return { id: top.id, reason: '有名さより出会いを大事にする一本として選びました。' };
}

// --- 完全フォールバック（プロバイダ全滅時） ---
export function fallbackEdit({ candidates, gemCandidates, editionConfig }) {
  const top = defaultTop(candidates, editionConfig.topCount);
  const usedIds = new Set(top);
  const sections = defaultSections(candidates, editionConfig, usedIds);
  const allSelectedIds = [...top, ...sections.flatMap((s) => s.articleIds)];
  const byId = new Map([...candidates, ...gemCandidates].map((c) => [c.id, c]));

  const summaries = {};
  const categories = {};
  for (const id of allSelectedIds) {
    const item = byId.get(id);
    summaries[id] = summarizeFromSnippet(item);
    categories[id] = deriveCategory(item);
  }
  const hiddenGem = defaultHiddenGem(gemCandidates);
  if (hiddenGem) categories[hiddenGem.id] = deriveCategory(byId.get(hiddenGem.id));

  const topTitle = byId.get(top[0])?.title;
  const comment = topTitle
    ? `本日は編集AIが利用できなかったため、Heat順の自動編成でお届けします。一面は「${topTitle}」です。`
    : '本日は取得できたソースが少なく、編集AIも利用できなかったため、静かな紙面をお届けします。';

  return {
    theme: { title: FALLBACK_THEME_TITLE, note: '本日は自動編成でお届けします。' },
    top,
    sections,
    summaries,
    editorial: {
      comment,
      passedOver: '本日は自動編成のため、見送り記事の選定は行っていません。',
      signature: '—— YZRS Times 編集長',
    },
    hiddenGem,
    categories,
    byId,
  };
}

// --- 記事オブジェクトの組み立て（LLM出力 + 収集済みの事実データを結合） ---
function toArticle(id, edited) {
  const item = edited.byId.get(id);
  const summaryJa = edited.summaries[id] ?? summarizeFromSnippet(item);
  const cat = edited.categories[id] ?? deriveCategory(item);
  return {
    id: item.id,
    title: item.title,
    url: item.url,
    source: item.source,
    sourceId: item.sourceId,
    publishedAt: item.publishedAt,
    summaryJa,
    category: cat.category,
    keywords: cat.keywords,
    heat: item.heat,
    image: null,
  };
}

export function assemble(edited) {
  const allSelectedIds = [...edited.top, ...edited.sections.flatMap((s) => s.articleIds)];
  const articles = allSelectedIds.map((id) => toArticle(id, edited));
  const hiddenGem = edited.hiddenGem
    ? { article: toArticle(edited.hiddenGem.id, edited), reason: edited.hiddenGem.reason }
    : null;
  return {
    theme: edited.theme,
    editorial: edited.editorial,
    top: edited.top,
    sections: edited.sections.map((s) => ({ id: s.id, title: s.title, articleIds: s.articleIds })),
    articles,
    hiddenGem,
  };
}

// 号を跨いで要約を使い回す：キャッシュ済みならモデル出力を上書きし、未キャッシュなら書き込む。
function applySummaryCache(edited, summaryCache) {
  if (!summaryCache) return;
  const allIds = [...edited.top, ...edited.sections.flatMap((s) => s.articleIds)];
  if (edited.hiddenGem) allIds.push(edited.hiddenGem.id);
  for (const id of allIds) {
    const item = edited.byId.get(id);
    if (!item) continue;
    const cached = summaryCache.entries[urlCacheKey(item.url)];
    if (cached?.summaryJa) {
      edited.summaries[id] = cached.summaryJa;
    } else {
      const finalSummary = edited.summaries[id] ?? summarizeFromSnippet(item);
      edited.summaries[id] = finalSummary;
      setSummaryCache(summaryCache, item.url, finalSummary);
    }
  }
}

// --- エントリポイント ---
export async function edit({ editorPromptTemplate, candidates, gemCandidates, editionConfig, prevIssue, recentThemes = [], sourcesConfig, providerName, apiKey, summaryCache }) {
  if (candidates.length === 0) {
    const edited = fallbackEdit({ candidates, gemCandidates, editionConfig });
    applySummaryCache(edited, summaryCache);
    return { result: assemble(edited), provider: 'fallback', model: 'fallback' };
  }

  const promptCtx = buildPromptContext({
    editorPromptTemplate,
    candidates,
    gemCandidates,
    editionConfig,
    prevIssue,
    recentThemes,
    maxSnippetChars: sourcesConfig.editor.maxSnippetChars,
    summaryCache,
  });

  const provider = PROVIDERS[providerName] ?? PROVIDERS.mock;
  let raw = null;
  let modelUsed = providerName;
  try {
    const res = await provider.generate(promptCtx, { candidates, gemCandidates, editionConfig, models: sourcesConfig.editor.models, apiKey });
    raw = res.output;
    modelUsed = res.model;
  } catch (err) {
    console.error(`編集AI(${providerName})が失敗したためフォールバックします: ${err?.message ?? err}`);
    raw = null;
  }

  const validated = raw ? validateAndRepair(raw, { candidates, gemCandidates, editionConfig }) : null;
  const finalProvider = validated ? providerName : 'fallback';
  const finalModel = validated ? modelUsed : 'fallback';
  const edited = validated ?? fallbackEdit({ candidates, gemCandidates, editionConfig });
  const repeated = findThemeRepeat(edited.theme?.title, recentThemes);
  if (repeated) {
    console.warn(`テーマが過去号と重複しています: 『${edited.theme.title}』 (issue #${repeated.issueNo} 『${repeated.theme}』)`);
  }
  applySummaryCache(edited, summaryCache);
  return { result: assemble(edited), provider: finalProvider, model: finalModel };
}
