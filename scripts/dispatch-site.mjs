import { dispatchPayload } from './package-times-delivery.mjs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const SITE_REPOSITORY = 'yzrswork/yzrswork-site';
const SITE_WORKFLOW = 'sync-times.yml';
const SITE_API_URL = `https://api.github.com/repos/${SITE_REPOSITORY}/actions/workflows/${SITE_WORKFLOW}/dispatches`;
const MAIN_REF = 'refs/heads/main';

export class SiteDispatchError extends Error {
  constructor(message, { status, cause } = {}) {
    super(message, { cause });
    this.name = 'SiteDispatchError';
    this.status = status;
  }
}

export function isTransientDispatchFailure({ status, error } = {}) {
  if (Number.isInteger(status)) return status >= 500 && status <= 599;
  return Boolean(error);
}

export async function dispatchWithOneRetry(send) {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await send();
      if (response?.ok) return { attempts: attempt };
      const failure = new SiteDispatchError(
        `Site workflow dispatch failed with HTTP ${String(response?.status ?? 'unknown')}`,
        { status: response?.status },
      );
      if (attempt === 1 && isTransientDispatchFailure({ status: failure.status })) continue;
      throw failure;
    } catch (error) {
      if (error instanceof SiteDispatchError) throw error;
      if (attempt === 1 && isTransientDispatchFailure({ error })) continue;
      throw new SiteDispatchError('Site workflow dispatch transport failed', { cause: error });
    }
  }
  throw new SiteDispatchError('Site workflow dispatch failed after one retry');
}

export async function dispatchSite({ token, sourceRunId, sourceSha, edition, publishedAt, fetchImpl = fetch }) {
  if (!token) throw new SiteDispatchError('SITE_SYNC_ENABLED=true but SITE_SYNC_TOKEN is not configured');
  const inputs = dispatchPayload({ sourceRunId, sourceSha, edition, publishedAt });
  const result = await dispatchWithOneRetry(() => fetchImpl(SITE_API_URL, {
    method: 'POST',
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'x-github-api-version': '2022-11-28',
    },
    body: JSON.stringify({ ref: 'main', inputs }),
    signal: AbortSignal.timeout(15000),
  }));
  return { ...result, inputs };
}

async function main() {
  if (process.env.GITHUB_REF !== MAIN_REF) {
    console.log(`[times-delivery] Site dispatch skipped outside ${MAIN_REF}`);
    return;
  }
  const result = await dispatchSite({
    token: process.env.GH_TOKEN,
    sourceRunId: process.env.SOURCE_RUN_ID,
    sourceSha: process.env.SOURCE_SHA,
    edition: process.env.EDITION,
    publishedAt: process.env.PUBLISHED_AT,
  });
  console.log(`[times-delivery] Site dispatch accepted after ${result.attempts} attempt(s)`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(`[times-delivery] ERROR: ${error.message}`);
    process.exitCode = 1;
  });
}
