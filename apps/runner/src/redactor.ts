/**
 * 아는 토큰을 글에서 지운다. AI CLI의 출력과 오류는 러너가 쓴 글이 아니라서 토큰이 섞여 들어올 수 있다.
 * 러너의 로그와 서버로 보내는 기록은 모두 여기를 지난다.
 * 받은 값이 아니어도 Anthropic 토큰 모양(sk-ant-)이면 지운다: 러너의 로그는 일마다 받는 토큰의 값을 모른다.
 */
export class Redactor {
  private static readonly MARK = '[지움: 토큰]';
  private static readonly AI_TOKEN = /sk-ant-[A-Za-z0-9_-]+/g;

  private readonly secrets: readonly string[];

  /** 없거나 빈 값은 뺀다. 빈 값으로 나누면 글자마다 표시가 들어간다 */
  constructor(secrets: readonly (string | null)[]) {
    this.secrets = secrets.filter((secret) => !!secret) as string[];
  }

  /** 작업 토큰처럼 일하는 동안만 아는 값을 더한다 */
  with(secret: string | null): Redactor {
    return new Redactor([...this.secrets, secret]);
  }

  clean(text: string): string {
    return this.secrets
      .reduce((out, secret) => out.split(secret).join(Redactor.MARK), text)
      .replace(Redactor.AI_TOKEN, Redactor.MARK);
  }
}

/** 러너의 로그. 시각을 붙이고 토큰을 지운다 */
export class RunLog {
  constructor(private readonly redactor: Redactor) {}

  info(message: string): void {
    console.log(`${new Date().toISOString()} ${this.redactor.clean(message)}`);
  }
}
