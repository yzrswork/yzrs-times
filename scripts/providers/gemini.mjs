// Gemini REST プロバイダ。sources.json editor.models を順に試し、404/無効モデルは次へ。
// キー未設定は即座に明示エラーを投げ、呼び出し元(edit.mjs)にフォールバックさせる。
// 失敗はすべて「[editor]」で始まる行で Actions ログに残す（どのモデルが、何のエラーで落ちたか）。
import { withRetry } from '../util.mjs';

const GEMINI_TIMEOUT_MS = 30000;
const ERROR_DETAIL_CHARS = 120;

// 1番手のモデルは混雑（503/429）が数分で解けることが多いので粘る（待ち合計 10+20+40+80=150秒）。
// 2番手以降は短く切り上げ、発行の遅れを抑える。
export const DEFAULT_RETRY_POLICY = {
  primary: { retries: 4, baseDelayMs: 10000 },
  fallback: { retries: 2, baseDelayMs: 4000 },
};

export class GeminiHttpError extends Error {
  constructor(model, status, apiStatus, detail) {
    const tail = [apiStatus, detail].filter(Boolean).join(' — ');
    super(`gemini ${model}: HTTP ${status}${tail ? ` ${tail}` : ''}`);
    this.name = 'GeminiHttpError';
    this.status = status;
    this.apiStatus = apiStatus;
  }
}

// 429（上限・混雑）と5xx（過負荷・障害）は待てば通る見込みがある。
// それ以外のHTTPエラー（404の無効モデル、400のリクエスト不正など）は待っても直らない。
// タイムアウト・通信エラー・空応答はHTTPステータスを持たないので再試行する。
export function isRetryable(err) {
  if (typeof err?.status === 'number') return err.status === 429 || err.status >= 500;
  return true;
}

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

export async function generate(promptCtx, { candidates, gemCandidates, editionConfig, models, apiKey, retryPolicy = DEFAULT_RETRY_POLICY }) {
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');
  if (!Array.isArray(models) || models.length === 0) throw new Error('editor.models is empty');

  const schema = buildResponseSchema(
    candidates.map((c) => c.id),
    gemCandidates.map((c) => c.id),
    editionConfig.sections.map((s) => s.id),
  );

  let lastErr;
  for (const [index, model] of models.entries()) {
    const policy = index === 0 ? retryPolicy.primary : retryPolicy.fallback;
    try {
      const text = await withRetry(() => callModel(model, apiKey, promptCtx.promptText, schema), {
        ...policy,
        shouldRetry: isRetryable,
        onError: (err, attempt, willRetry) => {
          const next = willRetry ? '再試行します' : 'このモデルを断念します';
          console.warn(`[editor] ${model} 試行${attempt + 1}/${policy.retries + 1} 失敗: ${err?.message ?? err}（${next}）`);
        },
      });
      const output = JSON.parse(text);
      if (index > 0) console.warn(`[editor] フォールバック先の ${model} で編集しました（先頭は ${models[0]}）`);
      return { output, model };
    } catch (err) {
      lastErr = err;
      // 404/無効モデルはもちろん、その他の失敗でも次のモデルへフォールバックする
      if (err instanceof SyntaxError) console.warn(`[editor] ${model} の応答がJSONとして読めません: ${err.message}`);
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
    if (!res.ok) throw await httpError(model, res);
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error(`gemini ${model}: empty response${data.candidates?.[0]?.finishReason ? ` (${data.candidates[0].finishReason})` : ''}`);
    return text;
  } catch (err) {
    if (err?.name === 'AbortError') throw new Error(`gemini ${model}: timeout ${GEMINI_TIMEOUT_MS}ms`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// エラー本文の error.status（UNAVAILABLE / RESOURCE_EXHAUSTED など）で混雑と上限超過を見分ける。
// 本文にAPIキーは含まれないが、念のため長さを切ってログに出す。
async function httpError(model, res) {
  let apiStatus = '';
  let detail = '';
  try {
    const body = await res.json();
    apiStatus = typeof body?.error?.status === 'string' ? body.error.status : '';
    detail = typeof body?.error?.message === 'string' ? body.error.message.slice(0, ERROR_DETAIL_CHARS) : '';
  } catch {
    // 本文がJSONでなければステータスコードだけで十分
  }
  return new GeminiHttpError(model, res.status, apiStatus, detail);
}
