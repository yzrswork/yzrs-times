# セットアップ手順

初回だけ、次の3つを手作業で行います（合計15分程度）。

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

## 2. Cloudflare Pages に接続する（10分・Cloudflare初体験向け）

Cloudflare Pagesは「GitHubリポジトリを接続すると、pushのたびに自動で世界中に配信される
静的ホスティング」です。GitHub Pagesの高速版だと思ってください。無料です。

1. https://dash.cloudflare.com/sign-up でアカウント作成（メールアドレスだけでOK）
2. ダッシュボード左メニューの **Workers & Pages** → **Create** → **Pages**タブ
3. **Connect to Git** をクリック → GitHubとの連携を許可
   - 「リポジトリへのアクセス」を聞かれたら **Only select repositories** で `yzrs-times` を選ぶ
4. `yzrs-times` リポジトリを選択して **Begin setup**
5. ビルド設定は次の通り：
   - **Project name**: `yzrs-times`（そのまま）
   - **Production branch**: `main`
   - **Build command**: （空欄のまま）
   - **Build output directory**: `public`
6. **Save and Deploy**

1〜2分で `https://yzrs-times.pages.dev` が発行されます。以後、リポジトリにpushされる
たび（＝毎朝の発行のたび）に自動でデプロイされます。

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

## 発行スケジュール

- 毎朝 **5:00 JST** に発行（Actionsのcronは数分〜数十分遅れることがあります）
- **8:00 JST** に補習発行：朝の発行が失敗・欠落していた場合だけ動きます
- Geminiが応答しない日も、要約なしのフォールバック紙面が必ず発行されます
