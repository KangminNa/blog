// 브라우저 푸시의 읽기 모양 (7단계). 웹이 `import type`으로 가져온다. 주인만 본다.

/** 브라우저가 구독할 때 쓰는 서버의 공개 키와 이 공간의 구독 수 */
export class PushKeyView {
  constructor(
    private readonly publicKey: string,
    private readonly subscriptions: number,
  ) {}

  toJSON() {
    return { publicKey: this.publicKey, subscriptions: this.subscriptions };
  }
}

/** 보내 보기의 결과: 받은 수와 못 받은 수 */
export class PushTestView {
  constructor(
    private readonly sent: number,
    private readonly failed: number,
  ) {}

  toJSON() {
    return { sent: this.sent, failed: this.failed };
  }
}
