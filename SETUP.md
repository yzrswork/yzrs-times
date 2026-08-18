# セットアップ手順

初回だけ、次の3つを手作業で行います（合計15分程度）。発行タイミングの精度を上げたい場合は4つ目も行います（任意、10分）。

## 1. Gemini APIキーを発行してリポジトリに登録する（5分）

Geminiには無料枠があり、クレジットカード登録は不要です。

1. https://aistudio.google.com/ を開き、Googleアカウントでログイン
2. 左メニュー（またはヘッダー）の **Get API key** → **Create API key** をクリック
3. 表示されたキー（`AIza...`）をコピー
4. GitHubのこのリポジトリ → **Settings** → **Secrets and variables** → **Actions**
5. **New repository secret** をクリックし、
   - Name: `GEMINI_API_KEY`
   - Secret: コピーしたキー
   を保存

> 無料枠の目安：Flash系モデルで1日数百リクエスト。この新聞は1日1〜3リクエストしか
> 使わないため、枠を心配する必要はありません。無料枠では入力データがGoogleの
> モデル改善に使われることがありますが、送っているのは公開ニュースの見出しと抜粋だけです。

## 2. Cloudflare に接続する（10分・Cloudflare初体験向け）

Cloudflareに「GitHubリポジトリを接続すると、pushのたびに自動で世界中に配信される」
無料ホスティングを設定します。

> **注**: Cloudflareは2026年現在、新規プロジェクトを「Pages」ではなく
> 「Workers（静的アセット配信）」に統合しています。ダッシュボードに
> `npx wrangler deploy` と表示される新しい画面が出るのはそのためです。
> このリポジトリには対応する設定ファイル `wrangler.jsonc` が含まれているので、
> 接続するだけで動きます。

1. https://dash.cloudflare.com/sign-up でアカウント作成（メールアドレスだけでOK）
2. ダッシュボード左メニューの **Workers & Pages**（または **Compute (Workers)**）→
   **Create** / **Create application**
3. 「**Import a repository**」（Gitリポジトリの接続）を選ぶ → GitHubとの連携を許可
   - 「リポジトリへのアクセス」を聞かれたら **Only select repositories** で `yzrs-times` を選ぶ
4. `yzrs-times` リポジトリを選択。設定は次の通り：
   - **Project / Worker name**: `yzrs-times`（そのまま）
   - **Production branch**: `main`
   - **Build command**: （空欄のまま）
   - **Deploy command**: `npx wrangler deploy`（デフォルトのまま）
5. **Save and Deploy**（Deploy）

1〜2分で `https://yzrs-times.<あなたのサブドメイン>.workers.dev` が発行されます。
以後、リポジトリにpushされるたび（＝毎朝の発行のたび）に自動でデプロイされます。

> 旧UIの **Pages** タブが表示される環境なら、従来どおり
> Connect to Git → Build output directory: `public` でも同じものが動きます。
> どちらでも紙面は変わりません。

> 紙面を自分だけに公開したい場合：Cloudflareダッシュボードの **Zero Trust** →
> **Access** でこのPagesドメインにメール認証（One-time PIN）を無料で掛けられます。
> 後からいつでも設定できるので、まずは公開のままで問題ありません。

## 3. 動作確認と保護設定（3分）

1. GitHubのこのリポジトリ → **Actions** タブ → **Publish Morning Edition** →
   **Run workflow** で手動発行（初回は `force` にチェック）
2. 完了後、`https://yzrs-times.pages.dev` で紙面が見えることを確認
3. **Settings** → **Branches** → **Add branch ruleset** で `main` への force push を
   禁止しておく（号のアーカイブはこのリポジトリが唯一の保管庫のため）
4. **Settings** → **Notifications** でActionsの失敗通知メールが届くことを確認
   （発行が失敗し続けると60日でcronが自動停止するため、失敗に気付けることが重要）

## 4. 発行タイミングの精度を上げる（任意、10分）

Actionsのscheduleトリガーは混雑時に数十分から3時間以上遅れることがあります（発行自体は必ず成功しますが、時刻がずれます）。発行時刻を5:17 JST、11:47 JST付近にできるだけ合わせたい場合は、scheduler/ディレクトリのCloudflare Workerを追加でデプロイします。

1. GitHubの自分のアカウント設定（右上のアバター、Settings、左メニュー最下部のDeveloper settings、Personal access tokens、Fine-grained tokens）から、新規トークンを発行
   - Repository access: Only select repositories で yzrs-times のみ選択
   - Permissions: Repository permissionsのActionsを Read and write に設定（他はすべて既定のNo accessのままでよい）
2. トークンをコピーし、scheduler/ディレクトリで次を実行
   ```
   npx wrangler login
   npx wrangler secret put GITHUB_PAT
   npx wrangler deploy
   ```
3. Cloudflareダッシュボードの Workers and Pages、yzrs-times-scheduler、Triggersタブで、cronが2本登録されていることを確認

この手順を行わなくても紙面は毎日発行されます。あくまで発行時刻の精度を上げるための追加設定です。詳細は scheduler/README.md にも記載しています。

## 発行スケジュール

- 朝刊：毎朝 **5:17 JST** に発行（Actionsのcronは混雑時に数十分から3時間以上遅れることがあります。scheduler/導入済みならこの時刻付近で発行されます）
- **7:47 JST** に朝刊の補習発行：朝の発行が失敗、欠落していた場合だけ実質的に動きます（スケジュール自体は毎日起動しますが、発行済みなら即終了します）
- 昼刊（技術インプット版）：毎昼 **11:47 JST** に発行、**13:17 JST** に補習発行
- Geminiが応答しない日も、要約なしのフォールバック紙面が必ず発行されます
- 紙面（latest.json）は常に最新の版を表示します。昼刊発行後は昼刊、翌朝はまた朝刊
- 夕刊（/evening.html）は発行のない常設ページ。縮刷版アーカイブ全体をGraph Viewで
  探索するモードで、朝刊、昼刊が発行されるたびに自動で育ちます

## Shadow cross-repo delivery token scopes

Shadow E2E setupで使うtokenは、実値をRepositoryへ保存せず、次の最小権限にします。

- `TIMES_ARTIFACT_READ_TOKEN`: `yzrswork/yzrs-times` のみにrepository accessを制限し、Actions: Read と Contents: Readを付与します。Contents readは、Site receiverが公開コミットのprovenanceを検証するために必要です。write権限は付与しません。
- `SITE_SYNC_TOKEN`: `yzrswork/yzrswork-site` のみにrepository accessを制限し、Actions: Writeだけを付与します。Site Contents: Writeは付与しません。
- Site receiverの `GITHUB_TOKEN`: `yzrswork-site` のworkflowが自身の `public/data/` を受け入れた場合のcommit/pushに使うSite repository credentialです。Times senderのcredentialではありません。

`SITE_SYNC_ENABLED` はこのハードニング作業では変更しません。Cloudflare、DNS、custom domain、deploy、production cutoverも変更しません。
