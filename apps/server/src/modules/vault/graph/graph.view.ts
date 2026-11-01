// 그래프의 읽기 모양. 웹이 `import type`으로 가져오므로 아무것도 import하지 않는다 (객체설계 6장).

/** 점 하나: 카테고리 · wiki · 세션 · 글. parent가 주소 하나이고, null이면 도착 구역이나 미분류다 */
export class GraphNodeView {
  constructor(
    readonly id: string,
    readonly kind: string,
    readonly label: string,
    readonly parent: string | null,
    /** public · private. 카테고리는 공개 범위가 없다 */
    readonly visibility: string | null,
    /** 글의 주소. 글을 여는 링크에 쓴다 */
    readonly slug: string | null,
  ) {}

  toJSON() {
    return {
      id: this.id,
      kind: this.kind,
      label: this.label,
      parent: this.parent,
      ...(this.visibility === null ? {} : { visibility: this.visibility }),
      ...(this.slug === null ? {} : { slug: this.slug }),
    };
  }
}

/** 주소 말고 다른 연결: material · link · ref */
export class GraphEdgeView {
  constructor(
    readonly src: string,
    readonly dst: string,
    readonly kind: string,
  ) {}

  toJSON() {
    return { src: this.src, dst: this.dst, kind: this.kind };
  }
}

/** 보는 사람에게 보여도 되는 것만 남은 그래프 */
export class GraphView {
  constructor(
    readonly nodes: readonly GraphNodeView[],
    readonly edges: readonly GraphEdgeView[],
  ) {}

  toJSON() {
    return { nodes: this.nodes.map((n) => n.toJSON()), edges: this.edges.map((e) => e.toJSON()) };
  }
}

/** 이웃 하나. relation은 parent · child · material · link · ref */
export class NeighborView {
  constructor(
    readonly id: string,
    readonly kind: string,
    readonly label: string,
    readonly relation: string,
  ) {}

  toJSON() {
    return { id: this.id, kind: this.kind, label: this.label, relation: this.relation };
  }
}

/** 점 하나와 그 이웃 */
export class NeighborsView {
  constructor(
    readonly node: GraphNodeView,
    readonly neighbors: readonly NeighborView[],
  ) {}

  toJSON() {
    return { node: this.node.toJSON(), neighbors: this.neighbors.map((n) => n.toJSON()) };
  }
}
