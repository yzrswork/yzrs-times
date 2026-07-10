# YZRS Times — 設計記録

2026-07-10 策定。壁打ち→設計レビュー2巡→自己レビューを経た確定版。

## コンセプト

**AI編集長が毎日編集する、自分専用のデジタル新聞。**

ニュースサイトでもRSSリーダーでもAIダッシュボードでもない。
「5〜10分で世界の面白い情報を効率よく把握し、創作や仕事に戻れる新聞」。
毎日ひとつ「知らなかった世界」に出会えること（Hidden Gem）を最大の価値とする。

- 朝刊（Morning Edition）: 5分で今日を知る — MVP対象
- 昼刊（Midday Edition）: 技術インプット — 将来
- 夕刊（Evening Edition): Obsidian Graph View風の探索モード — 将来

## 確定した意思決定

| 論点 | 決定 | 理由 |
|---|---|---|
| MVP範囲 | 朝刊のみ | 検証対象は「情報収集の質」。UIは後から育てる |
| 紙面の言語 | 見出し原文＋要約は日本語3行 | 翻訳コスト最小・原文リンクとの違和感なし |
| ホスティング | Cloudflare（Workers静的アセット）・専用リポジトリ | 毎日の発行commitで作品集の履歴を汚さない |
| 編集パイプライン | GitHub Actions cron ＋ **Gemini API無料枠** | 完全¥0。ユーザーはClaude Proのため、Claude Code Routineだと日々の利用枠を消費してしまう。Claudeは開発・改善役に回す |
| AIの守備範囲 | 編集判断のみ（選定・並び・要約・テーマ・コメント・Gem） | 収集・重複除去・Heat計算・事実データは決定論的コード |

### 検討して見送った案

- **Claude Code Routine方式**（サブスク枠内で毎朝Claudeが編集→push）: 編集品質は最高だが
  Pro枠を毎日消費する。Max環境なら再検討の価値あり
- **Cloudflare Workers Cron + KV**: 学びは大きいがMVPには過剰。Workersは将来の
  フィードバック収集が最初の導入点
- **合議制・自己批評つき編集LLM**: 品質向上僅少・複雑性倍増。哲学（simplicity）に反する

## アーキテクチャ

```
毎朝 5:00 JST — GitHub Actions cron（8:00 JSTに補習cron・冪等）
  collect（fail-soft収集）→ rank（重複除去・Heat・クォータ）
  → edit（Gemini: IDと文章のみ返す）→ publish（号JSON commit & push）
  → Cloudflare（Workers静的アセット）自動デプロイ → 静的紙面
```

設計レビュー（2巡＋自己レビュー）で確定した規律は README.md の
「紙面憲法」「データ契約」に集約。特に重要な5点:

1. **LLMは候補IDのみ参照**（URL・価格・日付を書かせない）— 幻覚の構造的排除
2. **生シグナル保存**（温度は再計算可能）＋ schemaVersion ＋ 出自記録（provider/model/promptHash）
3. **発行時点凍結**（相場・天気は「5:00時点」表記の静的スナップショット、号は発行後不変）
4. **検証可能な編集ルールはコードで強制**（Hidden Gemの30日履歴・有名ドメイン除外・スター範囲）
5. **編集プロンプトはコンテンツ**（prompts/editor.md、promptHashで号と紐付け、diffが編集方針の歴史になる）

## トークン/コスト戦略

- 最大のレバー: **閲覧ごとでなく発行ごとに生成**（APIコールは1日1〜3回で固定、PV無関係）
- AIに見せる前に機械で絞る（候補30件・snippet300字・ソース別クォータ8件）
- summary-cache（同一URLの再要約禁止）
- Gemini無料枠で¥0。将来 providers/ に claude.mjs / openai-compat.mjs を足すだけで移行可能

## 運用設計（5年の無人運転を想定）

- 敵は障害でなく**沈黙の劣化**: 補習cron（欠号対策）・ソース別連続失敗カウント・
  Actions失敗通知・60日push無しcron停止への注意（SETUP.md記載）
- 全ソースfail-soft（Promise.allSettled）。Google Trends RSS・Reddit系は非公式/遮断リスクで
  optional扱い
- Gemini全滅時も要約なしフォールバック紙面を必ず発行（「本日は自動編成」と正直に）
- 冪等発行: 同日同版は上書き・号数再利用。cron×手動dispatchの二重実行に安全

## 将来拡張の布石（実装済みの範囲）

- 記事に category / keywords を第1号から蓄積 → 夕刊Graph View・検索・関連記事の原料
- editions/*.json による版のデータ駆動化 → 昼刊は設定ファイル追加のみ
- フィードバック・切り抜きはlocalStorage → 将来Workers KVへ（最初のWorkers学習題材）
- 紙面RSS配信・週刊まとめ特別号・「明日の朝刊で深掘り」は構想のみ（README外・ここに記録）

## 追記（2026-07-11）: 昼刊・夕刊を実装

- **昼刊**: editions/midday.json + publish-midday.yml（12:00 JST・13:00補習）。技術インプット専門版。
  ソースに Zenn / Qiita / Lobsters を追加（optional・fail-soft）。設計どおり「設定ファイル追加のみ」で増設できた
- **夕刊**: 「毎夕発行される号」ではなく**縮刷版アーカイブ全体の常設探索モード**として設計判断。
  public/evening.html（Obsidian Graph View風・単一ファイル・依存なしCanvas）が
  public/data/graph.json を読む。graph.json は scripts/build-graph.mjs が全号JSONから
  再導出する派生物（データ契約の「号JSONが正典」に従う。AIなし・決定論）で、
  朝刊・昼刊の発行workflowが発行のたびに再生成する。ノードは号・記事・キーワード・カテゴリの
  4種、号同士は時系列の鎖でつなぐ。記事はURL正規化で全号横断の重複を1点に束ねる
