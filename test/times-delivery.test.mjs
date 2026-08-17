import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  dispatchPayload,
  packageDelivery,
  publicationOutputs,
  shouldDispatch,
} from '../scripts/package-times-delivery.mjs';

const SOURCE_SHA = '0123456789abcdef0123456789abcdef01234567';
const PUBLISHED_AT = '2026-08-17T08:00:00.000Z';

async function writeJson(root, path, value) {
  const file = join(root, path);
  await mkdir(join(file, '..'), { recursive: true });
  await writeFile(file, `${JSON.stringify(value)}\n`, 'utf8');
}

async function makePublicData() {
  const root = await mkdtemp(join(tmpdir(), 'times-public-data-'));
  await writeJson(root, 'latest.json', { schemaVersion: 1, edition: 'morning', generatedAt: PUBLISHED_AT });
  await writeJson(root, 'graph.json', { schemaVersion: 2, issues: [], articles: [] });
  await writeJson(root, 'index-manifest.json', { schemaVersion: 1, months: ['2026-08'] });
  await writeJson(root, 'issues-index-2026-08.json', { schemaVersion: 1, month: '2026-08', issues: [] });
  await writeJson(root, 'issues/2026-08-17-morning.json', { schemaVersion: 1, edition: 'morning' });
  return root;
}

test('A: new publication exposes published=true', () => {
  assert.deepEqual(publicationOutputs({ changed: true, sourceSha: SOURCE_SHA }), {
    published: 'true',
    sourceSha: SOURCE_SHA,
  });
});

test('B: no-change publication exposes published=false', () => {
  assert.equal(publicationOutputs({ changed: false, sourceSha: SOURCE_SHA }).published, 'false');
});

test('C: manifest uses the actual post-publication HEAD SHA', async () => {
  const sourceRoot = await makePublicData();
  const destination = await mkdtemp(join(tmpdir(), 'times-delivery-'));
  const result = await packageDelivery({
    sourceRoot,
    destination: join(destination, 'artifact'),
    sourceRunId: '123',
    sourceSha: SOURCE_SHA,
    edition: 'morning',
  });
  assert.equal(result.manifest.sourceSha, SOURCE_SHA);
  assert.equal(JSON.parse(await readFile(join(destination, 'artifact', 'delivery-manifest.json'), 'utf8')).sourceRunId, '123');
});

test('D: package contains only allowed JSON data and manifest', async () => {
  const sourceRoot = await makePublicData();
  const destination = await mkdtemp(join(tmpdir(), 'times-delivery-'));
  const { manifest } = await packageDelivery({
    sourceRoot,
    destination: join(destination, 'artifact'),
    sourceRunId: '123',
    sourceSha: SOURCE_SHA,
    edition: 'morning',
  });
  assert.equal(manifest.sourceRepository, 'yzrswork/yzrs-times');
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.publishedAt, PUBLISHED_AT);
});

test('E: unexpected file/path is rejected', async () => {
  const sourceRoot = await makePublicData();
  await writeFile(join(sourceRoot, 'index.html'), '<!doctype html>\n', 'utf8');
  const destination = await mkdtemp(join(tmpdir(), 'times-delivery-'));
  await assert.rejects(
    packageDelivery({
      sourceRoot,
      destination: join(destination, 'artifact'),
      sourceRunId: '123',
      sourceSha: SOURCE_SHA,
      edition: 'morning',
    }),
    /unexpected data path or type/,
  );
});

test('E2: output metadata cannot enter the artifact destination', async () => {
  const sourceRoot = await makePublicData();
  const destination = await mkdtemp(join(tmpdir(), 'times-delivery-'));
  await assert.rejects(
    packageDelivery({
      sourceRoot,
      destination: join(destination, 'artifact'),
      sourceRunId: '123',
      sourceSha: SOURCE_SHA,
      edition: 'morning',
      outputPath: join(destination, 'artifact', 'outputs.txt'),
    }),
    /output path must be outside/,
  );
});

test('F: dispatch is gated by the exact true repository variable', () => {
  assert.equal(shouldDispatch({ published: 'true', enabled: 'true' }), true);
  assert.equal(shouldDispatch({ published: 'true', enabled: 'false' }), false);
  assert.equal(shouldDispatch({ published: 'true', enabled: '' }), false);
});

test('G: disabled dispatch does not require a Site token', () => {
  assert.equal(shouldDispatch({ published: 'false', enabled: 'false' }), false);
  assert.deepEqual(dispatchPayload({
    sourceRunId: '123',
    sourceSha: SOURCE_SHA,
    edition: 'morning',
    publishedAt: PUBLISHED_AT,
  }), {
    source_run_id: '123',
    source_sha: SOURCE_SHA,
    edition: 'morning',
    published_at: PUBLISHED_AT,
  });
});
