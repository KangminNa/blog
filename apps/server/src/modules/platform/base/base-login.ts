/** 외부 로그인으로 확인한 사람: 그 서비스 안의 계정 id(바뀌지 않는 값)와 화면에 보일 이름 */
export class LoginIdentity {
  constructor(
    readonly subject: string,
    readonly label: string,
  ) {}
}

// 로그인 방법 하나 (예: GitHub, Google). 로그인 플러그인이 하위 클래스를 만들어 `cairn.addLogin(이름, …)`으로 등록한다.
// 플러그인은 "누구인지"만 알려주고, 확인값(state)·로그인 쿠키·주인인지 판단은 코어(account)가 한다.
// 그래서 플러그인이 아무 계정이나 주인으로 만들 수 없다: 주인이 먼저 연결해 둔 계정으로만 로그인된다.
export abstract class BaseLogin {
  /** 로그인 화면의 버튼 글자 (예: "GitHub로 로그인") */
  abstract readonly label: string;

  /** 그 서비스로 보낼 주소. 돌아올 때 쿼리에 state를 그대로 붙여 달라고 해야 한다 (OAuth의 state) */
  abstract start(callbackUrl: string, state: string): string;

  /** 돌아온 요청(쿼리)으로 누구인지 확인한다. 실패하면 DomainError */
  abstract finish(query: ReadonlyMap<string, string>, callbackUrl: string): Promise<LoginIdentity>;
}
