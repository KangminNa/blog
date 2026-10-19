import { BaseResponse } from '../../platform';
import type { Space } from './space';
import type { InstallStatusView, SpaceView } from './space.query';

/** 블로그 이름·소개·사이트 주소 (누구나). version은 고칠 때 돌려보낸다 */
export class SpaceResponse extends BaseResponse {
  private constructor(
    private readonly name: string,
    private readonly description: string,
    private readonly siteUrl: string | null,
    private readonly installed: boolean,
    private readonly version: number,
    private readonly hostedApps: boolean,
  ) {
    super();
  }

  static of(view: SpaceView): SpaceResponse {
    return new SpaceResponse(
      view.name,
      view.description,
      view.siteUrl,
      view.installed,
      view.version,
      view.hostedApps,
    );
  }

  static saved(space: Space): SpaceResponse {
    return new SpaceResponse(
      space.name,
      space.description,
      space.siteUrl,
      true,
      space.version,
      space.hostedApps,
    );
  }

  toJSON(): object {
    return {
      name: this.name,
      description: this.description,
      siteUrl: this.siteUrl,
      installed: this.installed,
      version: this.version,
      hostedApps: this.hostedApps,
    };
  }
}

/** 설치 마법사의 다음 단계: code(설치 코드) → owner(주인 계정) → done */
export class InstallStatusResponse extends BaseResponse {
  private constructor(private readonly view: InstallStatusView) {
    super();
  }

  static of(view: InstallStatusView): InstallStatusResponse {
    return new InstallStatusResponse(view);
  }

  toJSON(): object {
    const v = this.view;
    return { installed: v.installed, step: v.installed ? 'done' : v.passValid ? 'owner' : 'code' };
  }
}

/** 설치 코드가 맞음. 통행증은 쿠키로만 나간다 */
export class InstallPassResponse extends BaseResponse {
  private constructor(private readonly seconds: number) {
    super();
  }

  static of(seconds: number): InstallPassResponse {
    return new InstallPassResponse(seconds);
  }

  toJSON(): object {
    return { verified: true, expiresIn: this.seconds };
  }
}
