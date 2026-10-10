// 처리 단계별 실패 (docs/객체설계.md 3장).
// 진입 계층(ErrorFilter, MCP 도구)은 status와 toJSON()만 보고 응답을 만든다.

export abstract class DomainError extends Error {
  abstract readonly code: string;
  abstract readonly status: number;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }

  toJSON(): object {
    return { code: this.code, message: this.message };
  }
}

/** ① 인증: 누가 요청했는지 알 수 없음 */
export class Unauthenticated extends DomainError {
  readonly code = 'unauthenticated';
  readonly status = 401;
}

/** ② 요청 해석: 필드의 모양이 틀림. 틀린 필드를 모두 모아서 알려준다 */
export class InvalidRequest extends DomainError {
  readonly code = 'invalid_request';
  readonly status = 400;

  constructor(readonly fields: ReadonlyMap<string, string>) {
    super(`요청 형식이 맞지 않아요: ${[...fields.keys()].join(', ')}`);
  }

  override toJSON(): object {
    return { ...super.toJSON(), fields: Object.fromEntries(this.fields) };
  }
}

/** ③ 권한: 요청자에게 그 권한이 없음 */
export class Forbidden extends DomainError {
  readonly code = 'forbidden';
  readonly status = 403;

  constructor(
    readonly scope: string,
    message = `'${scope}' 권한이 필요해요`,
  ) {
    super(message);
  }

  override toJSON(): object {
    return { ...super.toJSON(), scope: this.scope };
  }
}

/** ③ 권한: 짧은 시간에 너무 많이 시도함 (설치 코드 찔러보기 등) */
export class TooManyRequests extends DomainError {
  readonly code = 'too_many_requests';
  readonly status = 429;
}

/** ④ 불러오기: 대상이 없음 */
export class NotFound extends DomainError {
  readonly code = 'not_found';
  readonly status = 404;
}

/** ⑤ 규칙: 그사이 다른 쪽이 먼저 바꿈 (version 불일치) */
export class Conflict extends DomainError {
  readonly code = 'conflict';
  readonly status = 409;
}

/** ⑤ 규칙: 도메인 규칙에 어긋남 */
export class RuleViolation extends DomainError {
  readonly code = 'rule_violation';
  readonly status = 422;
}

/** 외부 서비스(GitHub, SMTP 등)가 실패함 */
export class ExternalFailure extends DomainError {
  readonly code = 'external_failure';
  readonly status = 502;
}
