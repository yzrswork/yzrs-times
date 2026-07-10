#!/usr/bin/env node
// 発行パイプラインのオーケストレーター。
// node scripts/build-issue.mjs <edition> [--force]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collect } from './collect.mjs';
import { rank } from './rank.mjs';
import { edit } from './edit.mjs';
import * as store from './store.mjs';
import { jstDateStr, jstDateDisplay, sha256 } from './util.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function main() {
  const args = process.argv.slice(2);
  const editionArg = args.find((a) => !a.startsWith('--'));
  const force = args.includes('--force');
  if (!editionArg) {
    console.error('使い方: node scripts/build-issue.mjs <edition> [--force]');
    process.exit(1);
  }

  const now = new Date();
  const date = jstDateStr(now);
  const dateDisplay = jstDateDisplay(now);

  const sourcesConfig = store.readConfigJson('sources.json');
  const editionConfig = store.readConfigJson(path.join('editions', `${editionArg}.json`));
  if (!sourcesConfig || !editionConfig) {
    console.error(`設定ファイルが読めません: sources.json / editions/${editionArg}.json`);
    process.exit(1);
  }

  const existing = store.findExistingIssue(date, editionArg);
  if (existing && !force) {
    console.log(`発行済み: ${date} ${editionArg} (issue #${existing.issueNo})。スキップします。`);
    process.exit(0);
  }
  const issueNo = existing ? existing.issueNo : store.nextIssueNo();

  // --- collect ---
  const health = store.getSourceHealth();
  const collected = await collect(sourcesConfig, {
    now,
    githubToken: process.env.GITHUB_TOKEN,
    health,
    recordSourceResult: store.recordSourceResult,
  });
  store.saveSourceHealth(health);

  // --- rank ---
  const gemHistory = store.getGemHistory();
  const { candidates, gemCandidates } = rank(collected.items, {
    sourcesConfig,
    editionConfig,
    gemHistoryEntries: gemHistory.entries,
    now,
  });

  // --- edit ---
  const editorPromptTemplate = fs.readFileSync(path.join(ROOT, 'prompts', 'editor.md'), 'utf8');
  const prevIssue = store.loadLatestIssue();
  const summaryCache = store.getSummaryCache();
  const providerName = process.env.EDITOR_PROVIDER || sourcesConfig.editor.provider;

  const { result, provider, model } = await edit({
    editorPromptTemplate,
    candidates,
    gemCandidates,
    editionConfig,
    prevIssue,
    sourcesConfig,
    providerName,
    apiKey: process.env.GEMINI_API_KEY,
    summaryCache,
  });
  store.saveSummaryCache(summaryCache);

  // --- 号JSON組み立て（samples/sample-issue.jsonと同形） ---
  const promptHash = sha256(editorPromptTemplate).slice(0, 8);
  const issue = {
    schemaVersion: 1,
    issueNo,
    edition: editionArg,
    editionTitle: editionConfig.editionTitle,
    date,
    dateDisplay,
    pressTimeJst: `${date} ${editionConfig.pressTimeJst}`,
    generatedAt: now.toISOString(),
    generator: {
      appVersion: readAppVersion(),
      provider,
      model,
      promptHash,
    },
    theme: result.theme,
    editorial: result.editorial,
    weather: collected.weather,
    market: { fearGreed: collected.fearGreed, coins: collected.coins },
    top: result.top,
    sections: result.sections,
    articles: result.articles,
    hiddenGem: result.hiddenGem,
    unavailableSources: collected.unavailableSources,
  };

  const saved = store.saveIssue(issue);
  console.log(`発行しました: issue #${saved.issueNo} — ${date} ${editionArg}『${issue.theme.title}』`);
  if (collected.unavailableSources.length > 0) {
    console.log(`取得できなかったソース: ${collected.unavailableSources.join(', ')}`);
  }

  // fetch()のkeep-aliveソケットがイベントループを掴んだままだと自然終了しないため明示的にexitする
  // （CIのステップがハングして無駄にActions分数を消費するのを防ぐ）。
  process.exit(0);
}

function readAppVersion() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  return pkg.version;
}

main().catch((err) => {
  console.error('発行に失敗しました:', err);
  process.exit(1);
});
