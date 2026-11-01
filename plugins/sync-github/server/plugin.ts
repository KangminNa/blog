import { BasePlugin, type PluginContext } from '../../../apps/server/src/plugin-api';
import { CheckAction } from './check.action';
import { GithubGateway } from './github.gateway';
import { RestoreAction } from './restore.action';
import { RestorePreviewAction } from './restore-preview.action';
import { SyncJob } from './sync.job';
import { SyncNowAction } from './sync-now.action';

// GitHub 동기화: 보관 형식 파일을 저장소에 5분마다 맞춘다. 원본은 Cairn의 DB이고 저장소는 이력·백업이다.
// 복원(저장소 → Cairn)은 주인이 누르는 동작이다: 미리 보기로 확인하고, 빈 Cairn에 들여온다.
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
    const restorer = cairn.archiveRestorer();
    cairn.addAction('restore-preview', new RestorePreviewAction(github, branch, restorer, missing));
    cairn.addAction('restore', new RestoreAction(github, branch, restorer, missing));
  }
}
