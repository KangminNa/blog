import type { UserRow } from '../account.tables';

// 주인의 읽기 모양. 비밀번호 해시 칸은 읽지도 내보내지도 않는다.

/** 로그인한 주인. 관리 화면 위쪽에 보인다 */
export class OwnerView {
  constructor(private readonly row: Readonly<Pick<UserRow, 'login'>>) {}

  toJSON() {
    return { login: this.row.login };
  }
}

/** 로그인됨 (쿠키는 따로 나간다) */
export class LoggedInView {
  toJSON() {
    return { loggedIn: true };
  }
}
