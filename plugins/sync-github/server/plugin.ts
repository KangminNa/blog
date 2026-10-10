import { BasePlugin, type PluginContext } from '../../../apps/server/src/plugin-api';
import { CheckAction } from './check.action';
import { GithubGateway } from './github.gateway';
import { SyncJob } from './sync.job';
import { SyncNowAction } from './sync-now.action';

// GitHub 동기화: 보관 형식 파일을 저장소에 5분마다 맞춘다. 원본은 Cairn의 DB이고 저장소는 이력·백업이다.
// 복원(저장소 → Cairn)은 각 모듈의 복원 기능이 생기는 단계(M1~)에서 동작으로 더한다.
export default class SyncGithubPlugin extends BasePlugin {
  register(cairn: PluginContext): void {
    const settings = cairn.settings();
    const repo = settings.get('repo') ?? '';
    const token = settings.get('token') ?? '';
    const branch = settings.get('branch') || 'main';
    // 설정 화면에 보여줄 이름: 필수인데 비어 있는 것
    const missing = [...(repo ? [] : ['repo']), ...(token ? [] : ['token'])];
    const github =
      missing.length === 0
        ? new GithubGateway(repo, token, settings.get('apiUrl') || 'https://api.github.com')
        : null;
    const job = new SyncJob(github, branch, cairn.archiveReader(), missing);

    cairn.every('5m', job);
    cairn.addAction('check', new CheckAction(github, branch, missing));
    cairn.addAction('sync-now', new SyncNowAction(job));
  }
}
