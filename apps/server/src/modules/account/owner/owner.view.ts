import type { UserRow } from '../account.tables';

// 주인의 읽기 모양. 웹이 `import type`으로 가져온다 (객체설계 6장).
// 비밀번호 해시 칸은 읽지도 내보내지도 않는다. 로그인 토큰은 쿠키로만 나간다.

/** 로그인한 주인 (관리 화면 위쪽) */
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

/** 로그아웃 */
export class LoggedOutView {
  toJSON() {
    return { loggedOut: true };
  }
}

/** 비밀번호를 바꿈. 다른 기기의 로그인은 끝났다 */
export class PasswordChangedView {
  toJSON() {
    return { changed: true, otherSessionsEnded: true };
  }
}
