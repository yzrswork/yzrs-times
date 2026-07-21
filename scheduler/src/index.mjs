// GitHub Actions の scheduleトリガーはGitHub側の混雑で数十分から数時間遅れることがあるため、
// 発火精度の高いCloudflare Workers Cron Triggersから workflow_dispatch を狙った時刻に叩く。
// GitHub Actions側のscheduleトリガーは削除しない（このWorkerが失敗しても自己修復する安全網として残す）。
// 発行スクリプト側が「当日分は発行済みならスキップ」を判定するため、二重発行の心配はない。

const CRON_TO_WORKFLOW = {
  '17 20 * * *': 'publish.yml', // 5:17 JST 朝刊
  '47 2 * * *': 'publish-midday.yml', // 11:47 JST 昼刊
};

const REPO = 'yzrswork/yzrs-times';

export default {
  async scheduled(event, env, ctx) {
    const workflow = CRON_TO_WORKFLOW[event.cron];
    if (!workflow) {
      console.error(`未知のcron式です: ${event.cron}`);
      return;
    }
    ctx.waitUntil(dispatch(workflow, env.GITHUB_PAT));
  },
};

async function dispatch(workflow, token) {
  const res = await fetch(
    `https://api.github.com/repos/${REPO}/actions/workflows/${workflow}/dispatches`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'yzrs-times-scheduler',
      },
      body: JSON.stringify({ ref: 'main' }),
    }
  );
  if (!res.ok) {
    console.error(`dispatch失敗: ${workflow} status=${res.status} body=${await res.text()}`);
    return;
  }
  console.log(`dispatch成功: ${workflow}`);
}
