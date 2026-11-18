import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

import { generate, isRetryable } from '../scripts/providers/gemini.mjs';

const NO_WAIT = {
  primary: { retries: 3, baseDelayMs: 0 },
  fallback: { retries: 1, baseDelayMs: 0 },
};
const MODELS = ['gemini-3.5-flash', 'gemini-3.1-flash-lite'];
const OUTPUT = { theme: { title: 't', note: 'n' } };

const errorResponse = (code, status, message) =>
  new Response(JSON.stringify({ error: { code, status, message } }), { status: code });
const okResponse = () =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(OUTPUT) }] } }] }), { status: 200 });

let calls;
let warnings;
const realFetch = globalThis.fetch;
const realWarn = console.warn;

// モデルごとに返す応答を順番に並べる。並べた分を使い切ったら成功を返す。
function stubFetch(plan) {
  globalThis.fetch = async (url) => {
    const model = MODELS.find((m) => url.includes(`/models/${m}:`));
    calls.push(model);
    const next = plan[model]?.shift();
    return next ? next() : okResponse();
  };
}

const run = () =>
  generate(
    { promptText: 'prompt' },
    { candidates: [], gemCandidates: [], editionConfig: { sections: [{ id: 'a' }] }, models: MODELS, apiKey: 'test-key', retryPolicy: NO_WAIT },
  );

beforeEach(() => {
  calls = [];
  warnings = [];
  console.warn = (msg) => warnings.push(String(msg));
});

afterEach(() => {
  globalThis.fetch = realFetch;
  console.warn = realWarn;
});

test('1番手の503は再試行で粘り、通ればフォールバックしない', async () => {
  const overloaded = () => errorResponse(503, 'UNAVAILABLE', 'The model is overloaded. Please try again later.');
  stubFetch({ 'gemini-3.5-flash': [overloaded, overloaded] });
  const res = await run();
  assert.equal(res.model, 'gemini-3.5-flash');
  assert.deepEqual(res.output, OUTPUT);
  assert.deepEqual(calls, ['gemini-3.5-flash', 'gemini-3.5-flash', 'gemini-3.5-flash']);
  assert.equal(warnings.length, 2);
  assert.match(warnings[0], /\[editor\] gemini-3\.5-flash 試行1\/4 失敗: gemini gemini-3\.5-flash: HTTP 503 UNAVAILABLE — The model is overloaded/);
  assert.match(warnings[0], /再試行します/);
});

test('1番手が上限超過のまま尽きたら、理由をログに残して次のモデルへ', async () => {
  const exhausted = () => errorResponse(429, 'RESOURCE_EXHAUSTED', 'Quota exceeded.');
  stubFetch({ 'gemini-3.5-flash': [exhausted, exhausted, exhausted, exhausted] });
  const res = await run();
  assert.equal(res.model, 'gemini-3.1-flash-lite');
  assert.equal(calls.filter((m) => m === 'gemini-3.5-flash').length, 4);
  assert.ok(warnings.some((w) => /試行4\/4 失敗: .*HTTP 429 RESOURCE_EXHAUSTED.*このモデルを断念します/.test(w)));
  assert.ok(warnings.some((w) => /フォールバック先の gemini-3\.1-flash-lite で編集しました（先頭は gemini-3\.5-flash）/.test(w)));
});

test('404（無効モデル）は待たずに次のモデルへ移る', async () => {
  stubFetch({ 'gemini-3.5-flash': [() => errorResponse(404, 'NOT_FOUND', 'models/gemini-3.5-flash is not found')] });
  const res = await run();
  assert.equal(res.model, 'gemini-3.1-flash-lite');
  assert.deepEqual(calls, ['gemini-3.5-flash', 'gemini-3.1-flash-lite']);
  assert.match(warnings[0], /試行1\/4 失敗: .*HTTP 404 NOT_FOUND.*このモデルを断念します/);
});

test('ログにAPIキーを出さない', async () => {
  stubFetch({ 'gemini-3.5-flash': [() => errorResponse(500, 'INTERNAL', 'internal error')] });
  await run();
  for (const w of warnings) assert.ok(!w.includes('test-key'), w);
});

test('再試行の可否: 429と5xxとステータス無し（タイムアウト・空応答）は再試行、その他4xxはしない', () => {
  assert.equal(isRetryable({ status: 429 }), true);
  assert.equal(isRetryable({ status: 503 }), true);
  assert.equal(isRetryable({ status: 404 }), false);
  assert.equal(isRetryable({ status: 400 }), false);
  assert.equal(isRetryable(new Error('gemini x: timeout 30000ms')), true);
});
