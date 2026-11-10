import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { BaseGateway } from '../../platform';
import type { ServerRunnerPolicy } from './server-runner.policy';

// 서버 러너와 코드 러너 칸의 연결 값을 각자만 보는 볼륨에 쓴다 (CAIRN_RUNNER_PAIRING_FILE · CAIRN_CODE_PAIRING_FILE).
// 서버가 시작할 때 한 번 쓴다. 설정이 없으면(러너를 두지 않는 배포, 테스트) 그 파일은 쓰지 않는다.
// 다른 파일로 먼저 쓰고 이름을 바꿔, 러너가 반쯤 쓴 값을 읽지 않게 한다.
export class ServerRunnerGateway extends BaseGateway {
  protected readonly name = '러너 연결 값';
  /** 서버 러너 컨테이너는 다른 사용자로 돌아 읽기만 허락한다. 볼륨은 서버와 러너에게만 붙는다 */
  private static readonly SERVER_MODE = 0o644;
  /**
   * 칸의 러너는 root(권한 몇 개만, DAC_OVERRIDE 없음)이고 node 그룹(1000)에 든다. 그래서 그룹이 읽게 둔다.
   * 칸 안의 AI는 다른 사용자(agent)라 읽지 못한다: 칸에 셸이 있으니 연결 값이 AI에게 가면 AI가 스스로 칸 기기가 될 수 있다
   */
  private static readonly CODE_MODE = 0o640;

  constructor(
    private readonly policy: ServerRunnerPolicy,
    private readonly file: string | null,
    private readonly codeFile: string | null = null,
  ) {
    super();
  }

  /** 쓴 파일들의 경로. 설정이 없으면 빈 목록 */
  async publish(): Promise<readonly string[]> {
    const written: string[] = [];
    if (this.file) {
      await this.write(this.file, this.policy.secret(), ServerRunnerGateway.SERVER_MODE);
      written.push(this.file);
    }
    if (this.codeFile) {
      await this.write(this.codeFile, this.policy.codeSecret(), ServerRunnerGateway.CODE_MODE);
      written.push(this.codeFile);
    }
    return written;
  }

  private async write(file: string, secret: string, mode: number): Promise<void> {
    await this.call(async () => {
      await mkdir(dirname(file), { recursive: true });
      const temp = join(dirname(file), `.pairing-${process.pid}`);
      await writeFile(temp, `${secret}\n`, { mode });
      await rename(temp, file);
    });
  }
}
