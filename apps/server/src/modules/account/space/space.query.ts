import { Injectable } from '@nestjs/common';
import { type Actor, BaseQuery, Database } from '../../platform';
import { InstallPolicy } from './install.policy';
import { SpaceRepository } from './space.repository';

/** 블로그 정보 (누구나) */
export class SpaceView {
  constructor(
    readonly name: string,
    readonly description: string,
    readonly siteUrl: string | null,
    readonly installed: boolean,
    readonly version: number,
  ) {}
}

/** 설치 마법사가 다음 단계를 정할 때 보는 상태 */
export class InstallStatusView {
  constructor(
    readonly installed: boolean,
    readonly spaceId: string | null,
    readonly passValid: boolean,
  ) {}
}

// 공간 읽기. 설치됐다 = 주인이 있다.
@Injectable()
export class SpaceQuery extends BaseQuery {
  constructor(
    db: Database,
    private readonly install: InstallPolicy,
  ) {
    super(db);
  }

  async info(_actor: Actor): Promise<SpaceView> {
    const space = await new SpaceRepository(this.sql).current();
    return new SpaceView(
      space?.name ?? '',
      space?.description ?? '',
      space?.siteUrl ?? null,
      await this.hasOwner(),
      space?.version ?? 0,
    );
  }

  /** pass: 이 브라우저가 가진 설치 통행증 쿠키 */
  async installStatus(_actor: Actor, pass: string | null): Promise<InstallStatusView> {
    const space = await new SpaceRepository(this.sql).current();
    const spaceId = space?.id ?? null;
    return new InstallStatusView(
      await this.hasOwner(),
      spaceId,
      this.install.isValidPass(pass, spaceId),
    );
  }

  private async hasOwner(): Promise<boolean> {
    const [row] = await this.sql`
      SELECT EXISTS (SELECT 1 FROM account.space_members WHERE role = 'owner') AS yes`;
    return Boolean(row?.yes);
  }
}
