import { type ArgumentsHost, Catch } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { Database } from '../base/database';
import { DomainError } from '../base/errors';

// 처리 단계별 실패(DomainError)를 REST 응답으로 바꾼다. 상태 코드는 오류 클래스가 정한다.
// DB 시간 제한에 걸린 오류(잠금 대기 · 긴 쿼리)는 Busy(503)로 바꾼다. 트랜잭션 밖의 읽기에서도 나므로 입구에서 한 번 바꾼다.
// 그 밖의 오류(Nest의 HttpException, 우리 버그)는 Nest의 기본 처리에 그대로 넘긴다 (404 · 500).
@Catch()
export class DomainErrorFilter extends BaseExceptionFilter {
  override catch(error: unknown, host: ArgumentsHost): void {
    const known = error instanceof DomainError ? error : Database.busy(error);
    if (!known) {
      super.catch(error, host);
      return;
    }
    const response = host.switchToHttp().getResponse<{
      status(code: number): { json(body: object): void };
    }>();
    response.status(known.status).json(known.toJSON());
  }
}
