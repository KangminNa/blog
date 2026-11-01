import { TrackedEntity } from '../../platform';

// 글에 붙은 사진 한 장 (blog.assets). 파일 자체는 platform의 BlobStore에 있고, 이 행이 "이 글의 사진"이라는 사실이다.
// 같은 파일을 여러 글에 쓸 수 있고, 같은 글에 다시 올려도 행은 하나다.
// 방문자에게 보여 줄지는 이 행이 가리키는 글의 공개 범위로 정한다 (AssetQuery).
export class Asset extends TrackedEntity {
  private constructor(
    readonly postId: string,
    readonly blobHash: string,
  ) {
    // 행의 기본키가 (글, 파일)이고 버전 칸이 없다
    super(`${postId}/${blobHash}`, 1);
  }

  static open(postId: string, blobHash: string): Asset {
    return new Asset(postId, blobHash);
  }
}
