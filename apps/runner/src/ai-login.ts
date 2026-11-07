import type { CairnServer } from './cairn-server';
import { ClaudeCli } from './claude-cli';
import type { Job } from './job';
import { ServerUnreachable, ToolRefused } from './mcp-client';

/** 일 하나에 쓸 AI 토큰. 메모리에만 있고 AI CLI에게는 환경 변수로만 넘긴다 */
export class AiLogin {
  private constructor(
    readonly token: string | null,
    /** 토큰이 없는 이유. 일을 돌려줄 때 적는다 */
    readonly problem: string,
    /** 서버 로그인의 판. 바뀐 자격을 되돌려 쓸 때 보낸다. 환경 변수의 토큰이면 null */
    readonly version: number | null = null,
  ) {}

  static of(token: string, version: number | null = null): AiLogin {
    return new AiLogin(token, '', version);
  }

  static missing(problem: string): AiLogin {
    return new AiLogin(null, problem);
  }
}

// 일마다 쓸 토큰을 고른다. 환경 변수가 있으면 그것 (주인의 컴퓨터), 없으면 콘솔에 넣은 토큰을 서버에서 받는다 (서버 러너).
// 연결 확인은 콘솔에 넣은 토큰이 도는지 보는 일이라 환경 변수가 있어도 늘 서버에서 받는다.
// 쓸 로그인이 있는지는 일을 빌릴 때 서버가 본다 (next_jobs의 tools · own_logins). 그사이 만료되면 여기서 알고 돌려준다.
export class AiLogins {
  private static readonly EMPTY = '서버의 답에 AI 토큰이 없어요';

  constructor(
    private readonly server: Pick<CairnServer, 'aiLogin'>,
    private readonly envToken: string | null,
  ) {}

  /** 받지 못하면 왜 못 받았는지 담아 돌려준다. 기기 토큰이 틀린 것처럼 사람이 고쳐야 하는 오류만 던진다 */
  async forJob(job: Job): Promise<AiLogin> {
    // 환경 변수의 토큰은 Claude의 것이다 (CLAUDE_CODE_OAUTH_TOKEN). 다른 도구의 일에는 서버의 로그인을 받는다
    if (this.envToken !== null && job.tool === ClaudeCli.TOOL && !job.isAiTest)
      return AiLogin.of(this.envToken);
    try {
      const { token, version } = await this.server.aiLogin(job.tool);
      return token ? AiLogin.of(token, version) : AiLogin.missing(AiLogins.EMPTY);
    } catch (error) {
      if (!AiLogins.passing(error)) throw error;
      return AiLogin.missing((error as Error).message);
    }
  }

  /** 시간이 지나거나 주인이 토큰을 넣으면 풀리는 실패 */
  private static passing(error: unknown): boolean {
    return (
      error instanceof ServerUnreachable ||
      (error instanceof ToolRefused && error.code !== 'forbidden')
    );
  }
}
