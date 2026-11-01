import { BaseRequest, UnsupportedType } from '../../platform';
import { ImagePolicy } from './image.policy';

/** POST /api/posts/:id/assets. 본문이 파일 그대로다. 형식은 머리글이 아니라 파일의 앞부분으로 정한다 */
export class UploadAssetInput extends BaseRequest {
  private constructor(
    readonly postId: string,
    readonly bytes: Buffer,
    readonly mime: string,
  ) {
    super();
  }

  static from(id: string, body: unknown): UploadAssetInput {
    const postId = BaseRequest.read({ id }, (f) => f.uuid('id'));
    // 이미지 머리글이 아니면 본문을 읽지 않아서 Buffer가 아니다
    const mime = Buffer.isBuffer(body) ? ImagePolicy.mimeOf(body) : null;
    if (!mime) throw new UnsupportedType('PNG · JPEG · WebP · GIF 사진만 올릴 수 있어요');
    return new UploadAssetInput(postId, body as Buffer, mime);
  }
}
