// Gemini REST プロバイダ。sources.json editor.models を順に試し、404/無効モデルは次へ。
// キー未設定は即座に明示エラーを投げ、呼び出し元(edit.mjs)にフォールバックさせる。
import { withRetry } from '../util.mjs';

const GEMINI_TIMEOUT_MS = 30000;

function buildResponseSchema(candidateIds, gemIds, sectionIds) {
  const idEnum = { type: 'STRING', enum: candidateIds.length ? candidateIds : undefined };
  return {
    type: 'OBJECT',
    properties: {
      theme: {
        type: 'OBJECT',
        properties: { title: { type: 'STRING' }, note: { type: 'STRING' } },
        required: ['title', 'note'],
      },
      top: { type: 'ARRAY', items: idEnum },
      sections: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            id: { type: 'STRING', enum: sectionIds },
            articleIds: { type: 'ARRAY', items: idEnum },
          },
          required: ['id', 'articleIds'],
        },
      },
      summaries: { type: 'OBJECT' },
      editorial: {
        type: 'OBJECT',
        properties: { comment: { type: 'STRING' }, passedOver: { type: 'STRING' } },
        required: ['comment', 'passedOver'],
      },
      hiddenGem: {
        type: 'OBJECT',
        properties: {
          id: { type: 'STRING', enum: gemIds.length ? gemIds : undefined },
          reason: { type: 'STRING' },
        },
        required: ['id', 'reason'],
      },
      categories: { type: 'OBJECT' },
    },
    required: ['theme', 'top', 'sections', 'summaries', 'editorial', 'hiddenGem', 'categories'],
  };
}

export async function generate(promptCtx, { candidates, gemCandidates, editionConfig, models, apiKey }) {
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');
  if (!Array.isArray(models) || models.length === 0) throw new Error('editor.models is empty');

  const schema = buildResponseSchema(
    candidates.map((c) => c.id),
    gemCandidates.map((c) => c.id),
    editionConfig.sections.map((s) => s.id),
  );

  let lastErr;
  for (const model of models) {
    try {
      const text = await withRetry(() => callModel(model, apiKey, promptCtx.promptText, schema), { retries: 2, baseDelayMs: 800 });
      return { output: JSON.parse(text), model };
    } catch (err) {
      lastErr = err;
      // 404/無効モデルはもちろん、その他の失敗でも次のモデルへフォールバックする
    }
  }
  throw lastErr ?? new Error('gemini: all models failed');
}

async function callModel(model, apiKey, promptText, schema) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ parts: [{ text: promptText }] }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: schema },
      }),
    });
    if (!res.ok) throw new Error(`gemini ${model}: HTTP ${res.status}`);
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error(`gemini ${model}: empty response`);
    return text;
  } finally {
    clearTimeout(timer);
  }
}
