// 사진의 읽기 모양. 웹이 `import type`으로 가져오므로 아무것도 import하지 않는다 (객체설계 6장).

/** 올린 사진 하나. url을 글 본문에 넣는다 */
export class AssetView {
  constructor(
    readonly hash: string,
    readonly mime: string,
    readonly size: number,
  ) {}

  toJSON() {
    return {
      hash: this.hash,
      url: `/api/files/${this.hash}`,
      mime: this.mime,
      size: this.size,
    };
  }
}
