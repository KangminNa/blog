import { type ArgumentsHost, Catch, type ExceptionFilter } from '@nestjs/common';
import { DomainError } from '../base/errors';

// 처리 단계별 실패(DomainError)를 REST 응답으로 바꾼다. 상태 코드는 오류 클래스가 정한다.
@Catch(DomainError)
export class DomainErrorFilter implements ExceptionFilter {
  catch(error: DomainError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<{
      status(code: number): { json(body: object): void };
    }>();
    response.status(error.status).json(error.toJSON());
  }
}
