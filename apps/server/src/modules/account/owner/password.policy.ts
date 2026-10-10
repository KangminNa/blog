import { InvalidRequest } from '../../platform';

// 비밀번호 규칙. 길이만 본다 (숫자·특수문자 조합 규칙은 두지 않음: 긴 문장형 비밀번호가 더 안전하다).
export class PasswordPolicy {
  static readonly MIN = 10;
  static readonly MAX = 200;

  /** field: 화면에서 어느 칸인지 (password · next) */
  check(login: string, plain: string, field = 'password'): void {
    const problem =
      plain.length < PasswordPolicy.MIN
        ? `${PasswordPolicy.MIN}자 이상이어야 해요`
        : plain.length > PasswordPolicy.MAX
          ? `${PasswordPolicy.MAX}자 이하여야 해요`
          : plain.trim().toLowerCase() === login.toLowerCase()
            ? '아이디와 같은 비밀번호는 쓸 수 없어요'
            : null;
    if (problem) throw new InvalidRequest(new Map([[field, problem]]));
  }
}
