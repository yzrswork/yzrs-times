import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { dedupe, sourcesForEdition } from '../scripts/rank.mjs';

const readJson = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const sources = readJson('sources.json');
const editions = ['morning', 'midday'].map((name) => readJson(`editions/${name}.json`));
const ids = sources.sources.map((s) => s.id);

test('版が参照するソースはすべて sources.json に宣言されている', () => {
  for (const edition of editions) {
    for (const id of [...edition.sections.flatMap((s) => s.sources), ...(edition.hiddenGemSources ?? [])]) {
      assert.ok(ids.includes(id), `${edition.edition}: 未宣言のソース ${id}`);
    }
  }
});

test('宣言したソースはどれかの版で使われている（取得だけして捨てるソースを作らない）', () => {
  const used = new Set(editions.flatMap((e) => [...e.sections.flatMap((s) => s.sources), ...(e.hiddenGemSources ?? [])]));
  for (const id of ids) assert.ok(used.has(id), `どの版にも使われていないソース: ${id}`);
});

test('個別トピックのフィードは、同じサイトの汎用フィードより前に並ぶ', () => {
  // dedupeはシグナルが同点のとき先に取得したソースを残す。汎用フィードが先だと
  // 3Dプリンタや修理の記事が汎用側のソースIDになり、専用の欄に入らなくなる。
  const before = (a, b) => assert.ok(ids.indexOf(a) < ids.indexOf(b), `${a} は ${b} より前に置く`);
  before('hackaday-3dp', 'hackaday');
  before('hackaday-repair', 'hackaday');
  for (const topic of ['zenn-3dprinter', 'zenn-denshi', 'zenn-claudecode', 'zenn-muse', 'zenn-obsidian']) {
    before(topic, 'zenn-trend');
  }
});

test('同じ記事が汎用と個別の両方に出たら、個別フィードのソースIDが残る', () => {
  const item = (sourceId) => ({
    sourceId,
    url: 'https://hackaday.com/2026/11/13/fixing-a-dead-socket/',
    title: 'Fixing a Dead Socket LGA 1851 Mainboard with a Resistor',
    publishedAt: '2026-11-13T12:00:00Z',
    signals: {},
  });
  const ordered = ids.filter((id) => id === 'hackaday' || id === 'hackaday-repair').map(item);
  const [merged] = dedupe(ordered);
  assert.equal(merged.sourceId, 'hackaday-repair');
  assert.deepEqual(new Set(merged.crossSourceIds), new Set(['hackaday', 'hackaday-repair']));
});

test('版ごとの取得対象は、その版の欄とHidden Gemのソースだけ', () => {
  for (const edition of editions) {
    const picked = sourcesForEdition(sources, edition).sources.map((s) => s.id);
    const expected = new Set([...edition.sections.flatMap((s) => s.sources), ...edition.hiddenGemSources]);
    assert.deepEqual(new Set(picked), expected, edition.edition);
  }
  const morning = sourcesForEdition(sources, editions[0]).sources.map((s) => s.id);
  assert.ok(!morning.includes('hackaday'), '朝刊は昼刊専用のソースを取りに行かない');
});

test('hiddenGemSources が無い版では、gemPool のソースをすべて取得する', () => {
  const { hiddenGemSources, ...edition } = editions[1];
  const picked = sourcesForEdition(sources, edition).sources.map((s) => s.id);
  for (const s of sources.sources.filter((x) => x.gemPool)) assert.ok(picked.includes(s.id), s.id);
});
