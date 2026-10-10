import { DomainError } from '../../platform';

// OAuth 규격의 오류 모양 ({ error, error_description }). AI 도구(OAuth 클라이언트)가 이 모양만 읽는다.
//   invalid_request · invalid_client · invalid_grant · unsupported_grant_type · invalid_redirect_uri · invalid_client_metadata
export class OAuthError extends DomainError {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }

  override toJSON(): object {
    return { error: this.code, error_description: this.message };
  }
}
