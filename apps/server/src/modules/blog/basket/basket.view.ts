// 소재의 읽기 모양. 웹이 `import type`으로 가져오므로 아무것도 import하지 않는다 (객체설계 6장).

/** 소재 하나 */
export class BasketItemView {
  constructor(
    readonly id: string,
    readonly kind: string,
    /** 세션·글의 id */
    readonly refId: string | null,
    readonly url: string | null,
    readonly title: string | null,
    readonly note: string | null,
    readonly createdAt: Date,
  ) {}

  toJSON() {
    return {
      id: this.id,
      kind: this.kind,
      refId: this.refId,
      url: this.url,
      title: this.title,
      note: this.note,
      createdAt: this.createdAt.toISOString(),
    };
  }
}

/** 기본 상자의 소재 전부. 혼자 손으로 담는 목록이라 한 쪽에 다 보낸다 */
export class BasketView {
  constructor(readonly items: readonly BasketItemView[]) {}

  toJSON() {
    return { items: this.items.map((i) => i.toJSON()), next: null };
  }
}
