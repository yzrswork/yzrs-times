# YZRS Times 作業ルール

AI編集長が毎日編集する、自分専用のデジタル新聞の生成エンジン。号の生成、`times-delivery` artifact の作成、`yzrswork-site` への配送を担う。

## 先に読むもの

- 守ること（Production Site の責務をこのリポジトリへ戻さない、Site へ直接書かない、など）の正は、Vault（`yzrswork/obsidian-vault`）の `services/2026-WB-03_yzrs-times/PROJECT_2026-WB-03.md` の「維持事項」。ここには書き写さない。
- 生成の設計は `docs/DESIGN.md`、編集AIの取り扱いは `docs/EDITOR-AI.md`。

## Git

- main へ直接 push してよい（2026-11-19 Owner 判断。PR が増えすぎるため）。PR は Owner に頼まれたときだけ作る。
- main は毎日の発行が動いている本番。push の前に `npm test` と `npm run check` を通す。force push はしない。

## 更新ログ

- 2026-11-19 初版。
