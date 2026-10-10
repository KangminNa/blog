import { ExternalFailure } from './errors';

// DB 밖의 외부 세계(GitHub, SMTP, 파일 저장소 등)를 부르는 기반.
// 외부 라이브러리는 하위 클래스 안에서만 쓰고, 시간 제한과 재시도는 여기서 같은 방식으로 처리한다.
// 트랜잭션 안에서 부르지 않는다.
export abstract class BaseGateway {
  protected abstract readonly name: string;
  protected readonly timeoutMs: number = 10_000;
  protected readonly retries: number = 0;

  protected async call<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        return await work(AbortSignal.timeout(this.timeoutMs));
      } catch (error) {
        lastError = error;
      }
    }
    const reason = lastError instanceof Error ? lastError.message : String(lastError);
    throw new ExternalFailure(`${this.name} 호출에 실패했어요: ${reason}`);
  }
}
