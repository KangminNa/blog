import { BaseRequest } from '../../platform';
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
