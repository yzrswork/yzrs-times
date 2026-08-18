# yzrs-times-scheduler

朝刊、昼刊の発行を狙った時刻(5:17 JST、11:47 JST)に起動するためだけの、本体とは別のCloudflare Worker。

## これは何のためにあるか

GitHub Actionsのscheduleトリガーは、GitHub公式が「混雑時は遅延する、時刻を保証しない」と明言している仕様で、yzrs-timesでも実際に数十分から3時間超の遅延が発生していた(特に昼刊)。cron時刻の調整だけでは解決しない領域だったため、発火精度の高いCloudflare Workers Cron Triggersから`workflow_dispatch` APIを叩く形で、発行時刻をほぼ正確に固定する。

GitHub Actions側の`schedule`トリガー(publish.yml、publish-midday.yml)は削除していない。このWorkerが何らかの理由で動かなくなっても、既存のscheduleトリガーが(遅れてでも)最終的に発行する安全網として残る。発行スクリプト側はその日の号が既に発行済みなら即終了するため、両方が動いても二重発行にはならない。

Timesのcross-repo deliveryは既存publish workflowの成功後段にchainされるだけで、新しいcronやscheduler動作は追加しない。senderは `public/data/` のJSON artifactを作り、Site dispatchは `SITE_SYNC_ENABLED == 'true'` の場合だけ行う。既存のschedule fallbackと発行タイミングは変更しない。

## セットアップ

初回だけ、このディレクトリで以下を実行する(所要10分、詳細はリポジトリ直下のSETUP.md「4. 発行タイミングの精度を上げる」も参照):

```
npx wrangler login
npx wrangler secret put GITHUB_PAT
npx wrangler deploy
```

`GITHUB_PAT`は、yzrs-timesリポジトリのみ、Actions権限(Read and write)のみを付与したFine-grained Personal Access Token。

## 動作確認

デプロイ後、Cloudflareダッシュボードの Workers & Pages、`yzrs-times-scheduler`、Triggersタブの順に開き、cronが2本(5:17 JST、11:47 JST相当のUTC時刻)登録されていることを確認する。実際の発火確認は、翌朝、翌昼に`gh run list --repo yzrswork/yzrs-times`でworkflow_dispatchイベントのrunが狙った時刻の数分以内に記録されているかで行う。
