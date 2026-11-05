// 주인의 읽기 모양. 웹이 `import type`으로 가져오므로 아무것도 import하지 않는다 (객체설계 6장).

/** 로그인한 주인 (관리 화면 위쪽) */
export class OwnerView {
  constructor(readonly login: string) {}

  toJSON() {
    return { login: this.login };
  }
}
