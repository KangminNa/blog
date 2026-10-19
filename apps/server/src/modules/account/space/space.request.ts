import { BaseRequest } from '../../platform';

/** 설치 코드 확인: { "code": "K7QF-2M9X" } */
export class InstallCodeRequest extends BaseRequest {
  private constructor(readonly code: string) {
    super();
  }

  static from(raw: unknown): InstallCodeRequest {
    return BaseRequest.read(raw, (f) => new InstallCodeRequest(f.text('code', 20)));
  }
}

/** ChatGPT·Claude 앱 연결 허용 켜기·끄기: { on, version } */
export class HostedAppsRequest extends BaseRequest {
  private constructor(
    readonly on: boolean,
    readonly version: number,
  ) {
    super();
  }

  static from(raw: unknown): HostedAppsRequest {
    return BaseRequest.read(
      raw,
      (f) => new HostedAppsRequest(f.boolean('on'), f.integer('version', 1, 2_147_483_647)),
    );
  }
}

/** 블로그 이름·소개·사이트 주소. version은 화면이 불러올 때 받은 값. 사이트 주소를 비우면 그대로 둔다 */
export class RenameSpaceRequest extends BaseRequest {
  private constructor(
    readonly name: string,
    readonly description: string,
    readonly siteUrl: string | null,
    readonly version: number,
  ) {
    super();
  }

  static from(raw: unknown): RenameSpaceRequest {
    return BaseRequest.read(
      raw,
      (f) =>
        new RenameSpaceRequest(
          f.text('name', 80),
          f.optionalText('description', 300) ?? '',
          f.optionalText('siteUrl', 300),
          f.integer('version', 1, 2_147_483_647),
        ),
    );
  }
}
