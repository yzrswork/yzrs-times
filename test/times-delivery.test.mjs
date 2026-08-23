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
import {
  dispatchWithOneRetry,
  isTransientDispatchFailure,
} from '../scripts/dispatch-site.mjs';
import { writeGraph } from '../scripts/build-graph.mjs';

const SOURCE_SHA = '0123456789abcdef0123456789abcdef01234567';
const PUBLISHED_AT = '2026-08-17T08:00:00.000Z';

async function writeJson(root, path, value) {
  const file = join(root, path);
  await mkdir(join(file, '..'), { recursive: true });
  await writeFile(file, `${JSON.stringify(value)}\n`, 'utf8');
}

async function makePublicData() {
  const root = await mkdtemp(join(tmpdir(), 'times-public-data-'));
  const latest = {
    schemaVersion: 1,
    issueNo: 1,
    edition: 'morning',
    date: '2026-08-17',
    generatedAt: PUBLISHED_AT,
  };
  await writeJson(root, 'latest.json', latest);
  await writeJson(root, 'graph.json', { schemaVersion: 2, issues: [], articles: [] });
  await writeJson(root, 'index-manifest.json', { schemaVersion: 1, months: ['2026-08'] });
  await writeJson(root, 'issues-index-2026-08.json', {
    schemaVersion: 1,
    month: '2026-08',
    issues: [{ issueNo: 1, date: latest.date, edition: latest.edition, path: `issues/${latest.date}-${latest.edition}.json` }],
  });
  await writeJson(root, `issues/${latest.date}-${latest.edition}.json`, latest);
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

test('D: package contains only the strict JSON delivery contract', async () => {
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

test('F: short publication SHAs are rejected', async () => {
  const sourceRoot = await makePublicData();
  const destination = await mkdtemp(join(tmpdir(), 'times-delivery-'));
  await assert.rejects(
    packageDelivery({
      sourceRoot,
      destination: join(destination, 'artifact'),
      sourceRunId: '123',
      sourceSha: SOURCE_SHA.slice(0, 7),
      edition: 'morning',
    }),
    /full 40-character hexadecimal Git SHA/,
  );
});

test('G: output metadata cannot enter the artifact destination', async () => {
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

test('H: dispatch is gated by main and the exact true repository variable', () => {
  assert.equal(shouldDispatch({ published: 'true', enabled: 'true', ref: 'refs/heads/main' }), true);
  assert.equal(shouldDispatch({ published: 'true', enabled: 'true', ref: 'refs/heads/feature' }), false);
  assert.equal(shouldDispatch({ published: 'true', enabled: 'false', ref: 'refs/heads/main' }), false);
  assert.equal(shouldDispatch({ published: 'true', enabled: '', ref: 'refs/heads/main' }), false);
});

test('I: disabled dispatch does not require a Site token', () => {
  assert.equal(shouldDispatch({ published: 'false', enabled: 'false', ref: 'refs/heads/main' }), false);
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

test('J: only 5xx and transport failures are transient', () => {
  assert.equal(isTransientDispatchFailure({ status: 503 }), true);
  assert.equal(isTransientDispatchFailure({ status: 500 }), true);
  assert.equal(isTransientDispatchFailure({ status: 401 }), false);
  assert.equal(isTransientDispatchFailure({ status: 403 }), false);
  assert.equal(isTransientDispatchFailure({ status: 422 }), false);
  assert.equal(isTransientDispatchFailure({ error: new Error('connection reset') }), true);
});

test('K: a transient dispatch failure receives exactly one retry', async () => {
  let attempts = 0;
  const result = await dispatchWithOneRetry(async () => {
    attempts += 1;
    return attempts === 1 ? { ok: false, status: 503 } : { ok: true, status: 204 };
  });
  assert.equal(attempts, 2);
  assert.deepEqual(result, { attempts: 2 });
});

test('L: authentication failure is not retried', async () => {
  let attempts = 0;
  await assert.rejects(
    dispatchWithOneRetry(async () => {
      attempts += 1;
      return { ok: false, status: 403 };
    }),
    /HTTP 403/,
  );
  assert.equal(attempts, 1);
});

test('M: identical canonical issues generate byte-identical graph output', async () => {
  const root = await mkdtemp(join(tmpdir(), 'times-graph-'));
  const issuesRoot = join(root, 'issues');
  const graphFile = join(root, 'graph.json');
  await writeJson(issuesRoot, '2026-08-17-morning.json', {
    issueNo: 1,
    generatedAt: '2026-08-16T20:00:00.000Z',
    articles: [],
  });
  await writeJson(issuesRoot, '2026-08-17-midday.json', {
    issueNo: 2,
    generatedAt: PUBLISHED_AT,
    articles: [],
  });

  writeGraph({ issuesDir: issuesRoot, graphFile });
  const first = await readFile(graphFile);
  writeGraph({ issuesDir: issuesRoot, graphFile });
  const second = await readFile(graphFile);

  assert.deepEqual(second, first);
  const graph = JSON.parse(second);
  assert.equal(graph.generatedAt, PUBLISHED_AT);
  assert.deepEqual(graph.issues.map((issue) => issue.id), [
    'i:2026-08-17-morning',
    'i:2026-08-17-midday',
  ]);
});

test('N: malformed publication fails in the pre-push package boundary', async () => {
  const sourceRoot = await makePublicData();
  await writeJson(sourceRoot, 'graph.json', { schemaVersion: 2, issues: [] });
  const destination = await mkdtemp(join(tmpdir(), 'times-delivery-'));
  await assert.rejects(
    packageDelivery({
      sourceRoot,
      destination: join(destination, 'artifact'),
      sourceRunId: '123',
      sourceSha: SOURCE_SHA,
      edition: 'morning',
    }),
    /graph\.json articles must be an array/,
  );

  const action = await readFile(new URL('../.github/actions/publish-edition/action.yml', import.meta.url), 'utf8');
  const commitAt = action.indexOf('git commit -m');
  const validationStepAt = action.indexOf('- name: Validate exact committed delivery');
  const validateAt = action.indexOf('node scripts/package-times-delivery.mjs');
  const pushAt = action.indexOf('git push origin');
  assert.ok(commitAt >= 0 && commitAt < validateAt && validateAt < pushAt);
  assert.match(action.slice(validationStepAt, pushAt), /publication tree changed during delivery validation/);
  assert.match(action.slice(validationStepAt, pushAt), /if: success\(\)/);
});

test('O: the packaged snapshot is bound to the local commit selected for promotion', async () => {
  const action = await readFile(new URL('../.github/actions/publish-edition/action.yml', import.meta.url), 'utf8');
  const validateAt = action.indexOf('- name: Validate exact committed delivery');
  const pushAt = action.indexOf('- name: Push validated publication');
  const validationStep = action.slice(validateAt, pushAt);
  const pushStep = action.slice(pushAt);

  assert.match(validationStep, /SOURCE_SHA: \$\{\{ steps\.commit\.outputs\.source_sha \}\}/);
  assert.match(validationStep, /git rev-parse HEAD/);
  assert.match(validationStep, /git status --porcelain -- public\/data data/);
  assert.match(validationStep, /--source-sha "\$SOURCE_SHA"/);
  assert.match(pushStep, /git rev-parse HEAD/);
  assert.match(pushStep, /refusing to push a tree other than the validated publication/);
});
