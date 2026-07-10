# YZRS Times

**AI編集長が毎日編集する、自分専用のデジタル新聞。**

Less scrolling. More discovering.

これはニュースサイトでもRSSリーダーでもAIダッシュボードでもない。
5〜10分で世界の面白い情報を効率よく把握し、創作や仕事に戻るための新聞である。

## 仕組み

```
毎朝 5:00 JST — GitHub Actions（cron）
  ① collect : 無料API/RSSから収集（AIなし・全ソースfail-soft）
  ② rank    : 重複除去 → Heat Index計算 → ソース別クォータで候補30件に
  ③ edit    : LLM（Gemini無料枠）が編集長として、記事の選定・並び・
              日本語3行要約・今日のテーマ・編集長コメント・Hidden Gemを決める
  ④ publish : 号JSONを生成して commit & push
       ↓ pushを検知して Cloudflare Pages が自動デプロイ
静的な紙面 public/index.html が latest.json を読んで描画
```

ランニングコストは **¥0**（GitHub Actions無料枠・Gemini API無料枠・Cloudflare Pages無料枠）。

## 紙面憲法（変えないこと）

1. **1号15本以内。**「もっと見る」は作らない。紙面には終わりがある。
2. **号は発行後不変。** 同じ日に再訪しても紙面は変わらない。リアルタイム更新は永久にやらない。
3. **相場・天気は発行時点のスナップショット**（「◯月◯日 5:00時点」を明記して凍結）。
4. **一方向に読む。** 題字から「本日はここまで」まで、一度読んだら終わる構造。
5. **AIは編集判断のみ。** 収集・重複除去・Heat計算・事実データは決定論的コードが持つ。
6. **LLMは候補IDだけを参照する。** URL・価格・日付をLLMに書かせない（幻覚の構造的排除）。
7. **UIの語彙は新聞の言葉。** 発行・紙面・一面・編集部より・縮刷版。フィード/カード/更新は使わない。

## データ契約（アーカイブは何年も残る）

- 号JSON（`public/data/issues/YYYY-MM-DD-<edition>.json`）が**正典**。キャッシュ類はすべて再生成可能な派生物。
- **フィールドは追加のみ。** 意味の転用・削除は禁止。形を変えるときは `schemaVersion` を上げる。
- 時刻は二層：`date` はJSTカレンダー日（`"2026-07-11"`）、`generatedAt` はUTC ISO 8601。
- 各号は出自を記録する：`generator: { appVersion, provider, model, promptHash }`。
- Heat Indexは表示温度だけでなく**生シグナル**（`signals`）を保存する。式は後から全号再計算できる。
- 同日同版の再実行は**上書き**であり、号数は既存の番号を再利用する（採番の冪等性）。

スキーマの実例: `public/data/issues/2026-07-11-morning.json`（サンプル号）

## リポジトリ構成

```
public/            Cloudflare Pages が配信する公開ディレクトリ
  index.html       紙面（単一ファイル）
  data/            号アーカイブ・月次index・latest.json
scripts/           発行パイプライン（collect → rank → edit → publish）
  sources/         ソース型別フェッチャー（rss / hn / hatebu / coingecko / …）
  providers/       編集LLMプロバイダ（gemini / mock）
  store.mjs        data/ と public/data/ の読み書きはここに集約
prompts/editor.md  編集長の人格と編集の掟（コードではなく育てるコンテンツ）
editions/          版の構成定義（セクション・ソース・上限）
sources.json       情報源の宣言
data/              パイプラインの状態（gem履歴・要約キャッシュ・ソース死活）
samples/           dry-run用の固定候補fixture
```

## 開発

```bash
npm install
npm run dry-run          # mockプロバイダで発行（Geminiキー不要）
npm run serve            # http://localhost:8000 で紙面確認
GEMINI_API_KEY=... npm run publish:morning   # 本番と同じ発行
```

セットアップ手順（Cloudflare Pages・Gemini APIキー）は [SETUP.md](SETUP.md)。
