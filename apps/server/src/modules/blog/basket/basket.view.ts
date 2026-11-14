import type { BasketItemRow } from '../blog.tables';

// 소재의 읽기 모양. 웹이 `import type`으로 가져온다 (객체설계 6장).
// 표의 칸 중 무엇을 내보내는지는 여기 한 곳에만 적는다.

/** 소재 하나. refId: 세션·글의 id */
export class BasketItemView {
  constructor(private readonly row: Readonly<BasketItemRow>) {}

  toJSON() {
    const r = this.row;
    return {
      id: r.id,
      kind: r.kind,
      refId: r.ref_id,
      url: r.url,
      title: r.title,
      note: r.note,
      createdAt: r.created_at.toISOString(),
    };
  }
}

/** 기본 상자의 소재 전부. 혼자 손으로 담는 목록이라 한 쪽에 다 보낸다 */
export class BasketView {
  constructor(private readonly items: readonly BasketItemView[]) {}

  toJSON() {
    return { items: this.items.map((i) => i.toJSON()), next: null };
  }
}

/** basket_get의 답. MCP는 snake_case */
export class ToolBasketView {
  constructor(private readonly rows: readonly Readonly<BasketItemRow>[]) {}

  toJSON() {
    return {
      items: this.rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        ref_id: r.ref_id,
        url: r.url,
        title: r.title,
        note: r.note,
        created_at: r.created_at.toISOString(),
      })),
    };
  }
}

/** keep_page의 답 (브라우저 확장에게): 담은 소재, saved · duplicate(같은 주소를 이미 담았다) */
export class KeptPageView {
  constructor(
    private readonly itemId: string,
    private readonly status: string,
  ) {}

  toJSON() {
    return { item_id: this.itemId, status: this.status };
  }
}
