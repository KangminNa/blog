import { BaseRequest, FileSniff, TooLarge, UnsupportedType } from '../../platform';
import type { SpaceRow } from '../account.tables';

/** 설치 코드 확인: { "code": "K7QF-2M9X" } */
export class InstallCodeInput extends BaseRequest {
  private constructor(readonly code: string) {
    super();
  }

  static from(raw: unknown): InstallCodeInput {
    return BaseRequest.read(raw, (f) => new InstallCodeInput(f.text('code', 20)));
  }
}

/** ChatGPT·Claude 앱 연결 허용 켜기·끄기: { on, version } */
export class HostedAppsInput extends BaseRequest {
  private constructor(
    readonly on: boolean,
    readonly version: number,
  ) {
    super();
  }

  static from(raw: unknown): HostedAppsInput {
    return BaseRequest.read(raw, (f) => new HostedAppsInput(f.boolean('on'), f.version()));
  }
}

/**
 * PUT /api/space/logo?version=: 본문이 그림 파일 그대로다 (image/* 머리글).
 * 형식은 머리글이 아니라 파일의 앞부분으로 정한다. SVG는 스크립트를 담을 수 있어 받지 않는다
 */
export class UploadLogoInput extends BaseRequest {
  static readonly MAX_BYTES = 1024 * 1024;
  private static readonly IMAGES: readonly string[] = [
    FileSniff.PNG,
    FileSniff.JPEG,
    FileSniff.WEBP,
    FileSniff.GIF,
  ];

  private constructor(
    readonly bytes: Buffer,
    readonly mime: string,
    readonly version: number,
  ) {
    super();
  }

  static from(query: unknown, body: unknown): UploadLogoInput {
    // 주소의 값은 글자라 숫자로 바꿔 읽는다 (없거나 숫자가 아니면 틀린 필드)
    const raw = Number((query as Record<string, unknown> | null)?.version);
    const version = BaseRequest.read({ version: raw }, (f) => f.version());
    // 그림 머리글이 아니면 본문을 읽지 않아서 Buffer가 아니다
    const mime = Buffer.isBuffer(body) ? FileSniff.mimeOf(body) : null;
    if (!mime || !UploadLogoInput.IMAGES.includes(mime))
      throw new UnsupportedType('PNG · JPEG · WebP · GIF 그림만 올릴 수 있어요');
    if ((body as Buffer).length > UploadLogoInput.MAX_BYTES)
      throw new TooLarge('로고는 1MB까지예요');
    return new UploadLogoInput(body as Buffer, mime, version);
  }
}

/** POST /api/space/logo/delete { version } */
export class RemoveLogoInput extends BaseRequest {
  private constructor(readonly version: number) {
    super();
  }

  static from(raw: unknown): RemoveLogoInput {
    return BaseRequest.read(raw, (f) => new RemoveLogoInput(f.version()));
  }
}

/**
 * 블로그 이름·소개·사이트 주소. version은 화면이 불러올 때 받은 값. 사이트 주소를 비우면 그대로 둔다.
 * 이름만 공간 표의 칸이고(changes) 소개와 사이트 주소는 설정이다
 */
export class RenameSpaceInput extends BaseRequest {
  private constructor(
    readonly changes: Partial<SpaceRow>,
    readonly description: string,
    readonly siteUrl: string | null,
    readonly version: number,
  ) {
    super();
  }

  static from(raw: unknown): RenameSpaceInput {
    return BaseRequest.read(
      raw,
      (f) =>
        new RenameSpaceInput(
          { name: f.text('name', 80) },
          f.optionalText('description', 300) ?? '',
          f.optionalText('siteUrl', 300),
          f.version(),
        ),
    );
  }
}
