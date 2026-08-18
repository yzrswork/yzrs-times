import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SOURCE_REPOSITORY = 'yzrswork/yzrs-times';
export const DELIVERY_MANIFEST = 'delivery-manifest.json';
export const DELIVERY_SCHEMA_VERSION = 1;
export const SUPPORTED_EDITIONS = Object.freeze(['morning', 'midday']);

const REQUIRED_DATA_FILES = ['latest.json', 'graph.json', 'index-manifest.json'];
const ISSUE_PATH_PATTERN = /^issues\/\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])-(?:morning|midday)\.json$/;
const MONTH_INDEX_PATH_PATTERN = /^issues-index-\d{4}-(?:0[1-9]|1[0-2])\.json$/;

class DeliveryPackagingError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DeliveryPackagingError';
  }
}

function fail(message) {
  throw new DeliveryPackagingError(message);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeRunId(value) {
  const text = String(value ?? '').trim();
  if (!/^\d+$/.test(text) || BigInt(text) <= 0n) fail('sourceRunId must be a positive integer');
  return text;
}

function normalizeSha(value) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(text)) fail('sourceSha must be a full 40-character hexadecimal Git SHA');
  return text;
}

function normalizeEdition(value) {
  const text = String(value ?? '').trim();
  if (!SUPPORTED_EDITIONS.includes(text)) fail(`unsupported edition: ${text || '(empty)'}`);
  return text;
}

function canonicalPublishedAt(value) {
  const text = String(value ?? '').trim();
  if (!text || !Number.isFinite(Date.parse(text)) || new Date(text).toISOString() !== text) {
    fail('publishedAt must be canonical UTC ISO-8601');
  }
  return text;
}

function normalizeIssueDate(value, label = 'date') {
  const text = String(value ?? '').trim();
  if (!/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/.test(text)) {
    fail(`${label} must be YYYY-MM-DD`);
  }
  const parsed = new Date(`${text}T00:00:00.000Z`);
  if (parsed.toISOString().slice(0, 10) !== text) fail(`${label} must be a valid calendar date`);
  return text;
}

function normalizeIssueNo(value, label = 'issueNo') {
  if (!Number.isSafeInteger(value) || value <= 0) fail(`${label} must be a positive integer`);
  return value;
}

function safeRelativePath(filePath) {
  const normalized = filePath.replaceAll('\\', '/');
  const parts = normalized.split('/');
  if (!normalized || normalized.startsWith('/') || parts.includes('.') || parts.includes('..')) {
    fail(`unsafe path: ${filePath}`);
  }
  return normalized;
}

async function walkFiles(root, current = root, result = { files: [], directories: [] }) {
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const fullPath = join(current, entry.name);
    const relPath = safeRelativePath(relative(root, fullPath));
    const stats = await lstat(fullPath);
    if (stats.isDirectory()) {
      result.directories.push(relPath);
      await walkFiles(root, fullPath, result);
    } else if (stats.isFile()) {
      result.files.push({ path: relPath, fullPath });
    } else {
      fail(`symlink or unexpected filesystem type: ${relPath}`);
    }
  }
  return result;
}

async function readJson(filePath, displayPath) {
  let text;
  try {
    text = await readFile(filePath, 'utf8');
  } catch (error) {
    fail(`cannot read ${displayPath}: ${error.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    fail(`invalid JSON at ${displayPath}: ${error.message}`);
  }
}

function isDataPathAllowed(filePath) {
  return REQUIRED_DATA_FILES.includes(filePath)
    || MONTH_INDEX_PATH_PATTERN.test(filePath)
    || ISSUE_PATH_PATTERN.test(filePath);
}

function normalizeManifest(raw) {
  if (!isRecord(raw)) fail('delivery-manifest.json must contain a JSON object');
  if (raw.schemaVersion !== DELIVERY_SCHEMA_VERSION) fail('unsupported delivery manifest schemaVersion');
  if (raw.sourceRepository !== SOURCE_REPOSITORY) fail(`sourceRepository must be ${SOURCE_REPOSITORY}`);
  return {
    schemaVersion: DELIVERY_SCHEMA_VERSION,
    sourceRepository: SOURCE_REPOSITORY,
    sourceSha: normalizeSha(raw.sourceSha),
    sourceRunId: normalizeRunId(raw.sourceRunId),
    edition: normalizeEdition(raw.edition),
    publishedAt: canonicalPublishedAt(raw.publishedAt),
  };
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function validateLatestSnapshot(latest, expectedEdition) {
  if (!isRecord(latest)) fail('latest.json must contain a JSON object');
  if (latest.schemaVersion !== 1) fail('latest.json schemaVersion must be 1');
  const issueNo = normalizeIssueNo(latest.issueNo, 'latest.json issueNo');
  const date = normalizeIssueDate(latest.date, 'latest.json date');
  const edition = normalizeEdition(latest.edition);
  const generatedAt = canonicalPublishedAt(latest.generatedAt);
  if (expectedEdition && edition !== expectedEdition) fail('latest.json edition does not match workflow edition');
  return { issueNo, date, edition, generatedAt };
}

function validateGraph(graph) {
  if (!isRecord(graph)) fail('graph.json must contain a JSON object');
  if (graph.schemaVersion !== 2) fail('graph.json schemaVersion must be 2');
  if (!Array.isArray(graph.issues)) fail('graph.json issues must be an array');
  if (!Array.isArray(graph.articles)) fail('graph.json articles must be an array');
}

function validateIndexManifest(indexManifest, fileMap) {
  if (!isRecord(indexManifest) || indexManifest.schemaVersion !== 1 || !Array.isArray(indexManifest.months)) {
    fail('index-manifest.json must contain schemaVersion 1 and a months array');
  }
  for (const month of indexManifest.months) {
    if (typeof month !== 'string' || !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month)) {
      fail(`invalid issue index month: ${String(month)}`);
    }
    const issueIndexPath = `issues-index-${month}.json`;
    const index = fileMap.get(issueIndexPath);
    if (!index) fail(`${issueIndexPath} is required by index-manifest.json`);
    if (!isRecord(index.value) || index.value.schemaVersion !== 1 || index.value.month !== month || !Array.isArray(index.value.issues)) {
      fail(`${issueIndexPath} has an invalid monthly index structure`);
    }
  }
}

function validateCanonicalIssue(latest, identity, fileMap) {
  const issuePath = `issues/${identity.date}-${identity.edition}.json`;
  const issueFile = fileMap.get(issuePath);
  if (!issueFile) fail(`${issuePath} is required for latest.json`);
  if (!isRecord(issueFile.value)) fail(`${issuePath} must contain a JSON object`);
  for (const field of ['schemaVersion', 'issueNo', 'date', 'edition', 'generatedAt']) {
    if (issueFile.value[field] !== latest[field]) fail(`${issuePath} ${field} does not match latest.json`);
  }
  if (canonicalJson(issueFile.value) !== canonicalJson(latest)) fail(`${issuePath} does not match latest.json`);
  return issuePath;
}

function validateLatestMonthIndex(identity, fileMap, issuePath) {
  const month = identity.date.slice(0, 7);
  const indexPath = `issues-index-${month}.json`;
  const index = fileMap.get(indexPath)?.value;
  if (!index) fail(`${indexPath} is required for latest.json`);
  const matches = index.issues.some((entry) => isRecord(entry)
    && entry.issueNo === identity.issueNo
    && entry.date === identity.date
    && entry.edition === identity.edition
    && entry.path === issuePath);
  if (!matches) fail(`${indexPath} is missing the canonical latest issue entry`);
}

async function inspectDataRoot(dataRoot, expectedEdition = '') {
  let rootStats;
  try {
    rootStats = await lstat(dataRoot);
  } catch (error) {
    fail(`public data directory is not readable: ${error.message}`);
  }
  if (!rootStats.isDirectory()) fail('public data root must be a directory');

  const walked = await walkFiles(dataRoot);
  for (const directory of walked.directories) {
    if (directory !== 'issues') fail(`unexpected data directory: ${directory}`);
  }
  for (const file of walked.files) {
    if (!isDataPathAllowed(file.path)) fail(`unexpected data path or type: ${file.path}`);
    file.value = await readJson(file.fullPath, file.path);
  }

  const fileMap = new Map(walked.files.map((file) => [file.path, file]));
  for (const required of REQUIRED_DATA_FILES) {
    if (!fileMap.has(required)) fail(`${required} is required`);
  }

  const latest = fileMap.get('latest.json').value;
  const identity = validateLatestSnapshot(latest, expectedEdition);
  validateGraph(fileMap.get('graph.json').value);
  validateIndexManifest(fileMap.get('index-manifest.json').value, fileMap);
  const issuePath = validateCanonicalIssue(latest, identity, fileMap);
  validateLatestMonthIndex(identity, fileMap, issuePath);
  return { files: walked.files, latest };
}

async function inspectPackage(packageRoot) {
  const walked = await walkFiles(packageRoot);
  const dataFiles = [];
  let manifest;
  for (const directory of walked.directories) {
    if (directory !== 'data' && directory !== 'data/issues') {
      fail(`unexpected package directory: ${directory}`);
    }
  }
  for (const file of walked.files) {
    if (file.path === DELIVERY_MANIFEST) {
      manifest = normalizeManifest(await readJson(file.fullPath, DELIVERY_MANIFEST));
    } else if (file.path.startsWith('data/')) {
      dataFiles.push(file);
    } else {
      fail(`unexpected package path or type: ${file.path}`);
    }
  }
  if (!manifest) fail('delivery-manifest.json is required');
  await inspectDataRoot(join(packageRoot, 'data'), manifest.edition);
  return { files: walked.files, dataFiles, manifest };
}

export function publicationOutputs({ changed, sourceSha }) {
  return {
    published: changed ? 'true' : 'false',
    sourceSha: normalizeSha(sourceSha),
  };
}

export function shouldDispatch({ published, enabled, ref }) {
  return published === 'true' && enabled === 'true' && ref === 'refs/heads/main';
}

export function dispatchPayload({ sourceRunId, sourceSha, edition, publishedAt }) {
  return {
    source_run_id: normalizeRunId(sourceRunId),
    source_sha: normalizeSha(sourceSha),
    edition: normalizeEdition(edition),
    published_at: canonicalPublishedAt(publishedAt),
  };
}

export async function packageDelivery({ sourceRoot, destination, sourceRunId, sourceSha, edition, outputPath }) {
  const normalizedRunId = normalizeRunId(sourceRunId);
  const normalizedSha = normalizeSha(sourceSha);
  const normalizedEdition = normalizeEdition(edition);
  const inspected = await inspectDataRoot(sourceRoot, normalizedEdition);
  const publishedAt = canonicalPublishedAt(inspected.latest.generatedAt);
  const manifest = {
    schemaVersion: DELIVERY_SCHEMA_VERSION,
    sourceRepository: SOURCE_REPOSITORY,
    sourceSha: normalizedSha,
    sourceRunId: normalizedRunId,
    edition: normalizedEdition,
    publishedAt,
  };

  const destinationStats = await lstat(destination).catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (destinationStats && !destinationStats.isDirectory()) fail('delivery destination must be a directory');
  await mkdir(destination, { recursive: true });
  if ((await readdir(destination)).length > 0) fail('delivery destination must be empty');

  for (const file of inspected.files) {
    const target = join(destination, 'data', file.path);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(file.fullPath, target);
  }
  await writeFile(join(destination, DELIVERY_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await inspectPackage(destination);

  if (outputPath) {
    const outputRelative = relative(resolve(destination), resolve(outputPath));
    if (outputRelative === '' || (!outputRelative.startsWith('..') && !isAbsolute(outputRelative))) {
      fail('output path must be outside the delivery destination');
    }
    await writeFile(outputPath, [
      'packaged=true',
      `source_sha=${manifest.sourceSha}`,
      `source_run_id=${manifest.sourceRunId}`,
      `edition=${manifest.edition}`,
      `published_at=${manifest.publishedAt}`,
    ].join('\n') + '\n', 'utf8');
  }
  return { manifest };
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith('--')) fail(`unknown argument: ${argv[index]}`);
    args[argv[index].slice(2)] = argv[index + 1] ?? '';
    index += 1;
  }
  return args;
}

function requiredArg(args, name) {
  if (!args[name]) fail(`--${name} is required`);
  return args[name];
}

async function main(argv) {
  const args = parseArgs(argv);
  await packageDelivery({
    sourceRoot: requiredArg(args, 'source-root'),
    destination: requiredArg(args, 'destination'),
    sourceRunId: requiredArg(args, 'source-run-id'),
    sourceSha: requiredArg(args, 'source-sha'),
    edition: requiredArg(args, 'edition'),
    outputPath: args.output || '',
  });
  console.log('[times-delivery] package validated');
}

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === thisFile) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`[times-delivery] ERROR: ${error.message}`);
    process.exitCode = 1;
  });
}
