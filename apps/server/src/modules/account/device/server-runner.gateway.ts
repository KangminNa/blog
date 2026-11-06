import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { BaseGateway } from '../../platform';
import type { ServerRunnerPolicy } from './server-runner.policy';

// 서버 러너의 연결 값을 서버와 러너만 보는 볼륨에 쓴다 (CAIRN_RUNNER_PAIRING_FILE).
// 서버가 시작할 때 한 번 쓴다. 설정이 없으면(러너를 두지 않는 배포, 테스트) 아무것도 하지 않는다.
// 다른 파일로 먼저 쓰고 이름을 바꿔, 러너가 반쯤 쓴 값을 읽지 않게 한다.
export class ServerRunnerGateway extends BaseGateway {
  protected readonly name = '서버 러너 연결 값';

  constructor(
    private readonly policy: ServerRunnerPolicy,
    private readonly file: string | null,
  ) {
    super();
  }

  /** 썼으면 그 경로, 설정이 없으면 null */
  async publish(): Promise<string | null> {
    const file = this.file;
    if (!file) return null;
    const secret = this.policy.secret();
    await this.call(async () => {
      await mkdir(dirname(file), { recursive: true });
      const temp = join(dirname(file), `.pairing-${process.pid}`);
      // 러너 컨테이너는 다른 사용자로 돌아 읽기만 허락한다. 볼륨은 서버와 러너에게만 붙는다
      await writeFile(temp, `${secret}\n`, { mode: 0o644 });
      await rename(temp, file);
    });
    return file;
  }
}
