import { Injectable } from '@nestjs/common';
import {
  Actor,
  AttemptLimiter,
  BaseService,
  BlobStore,
  Conflict,
  Database,
  Forbidden,
  NotFound,
} from '../../platform';
import { InstallPolicy } from './install.policy';
import { Space } from './space';
import type {
  HostedAppsInput,
  InstallCodeInput,
  RemoveLogoInput,
  RenameSpaceInput,
  UploadLogoInput,
} from './space.input';
import { SpaceQuery } from './space.query';
import { SpaceRepository } from './space.repository';

// 공간 쓰기: 설치 코드 확인(공간 만들기), 블로그 이름·소개·사이트 주소 바꾸기, 로고, 앱 연결 허용.
@Injectable()
export class SpaceService extends BaseService {
  /** 설치 코드는 한 곳에서 1분에 5번까지 */
  private readonly attempts = new AttemptLimiter(5, 60_000);

  constructor(
    db: Database,
    private readonly install: InstallPolicy,
    private readonly spaces: SpaceQuery,
    private readonly blobs: BlobStore,
  ) {
    super(db);
  }

  /** 설치 코드가 맞으면 공간을 만들고(없을 때) 10분짜리 설치 통행증을 돌려준다. from: 요청한 곳(IP) */
  async verifyInstallCode(actor: Actor, req: InstallCodeInput, from: string): Promise<string> {
    this.attempts.hit(AttemptLimiter.place(from));
    if (!this.install.matches(req.code)) throw new Forbidden('install', '맞지 않는 설치 코드예요');
    if ((await this.spaces.installStatus(actor, null)).installed)
      throw new Conflict('이미 설치된 블로그예요. 로그인해 주세요');
    const space = await this.transaction(async (tx) => {
      const repo = new SpaceRepository(tx);
      const found = (await repo.lockCurrent()) ?? Space.open();
      if (found.isNew) await repo.save(found);
      return found;
    }).catch(async (error) => {
      // 두 브라우저가 동시에 처음 공간을 만들면 하나만 들어간다. 그 공간을 쓴다
      if (!Database.isUniqueViolation(error)) throw error;
      return new SpaceRepository(this.db.sql).current();
    });
    if (!space) throw new NotFound('블로그 공간을 만들지 못했어요');
    return this.install.issuePass(space.id);
  }

  rename(actor: Actor, req: RenameSpaceInput): Promise<Space> {
    return this.change(actor, req.version, (space) => {
      space.edit(req.changes);
      space.describe(req.description, req.siteUrl);
    });
  }

  /**
   * 로고 올리기 (주인만). 파일은 트랜잭션 밖에서 쓰고(같은 내용이면 있던 파일), 공간에는 해시만 남긴다.
   * 판이 낡아 저장하지 못하면 파일만 남고, 아무도 쓰지 않으니 platform의 청소가 지운다
   */
  async uploadLogo(actor: Actor, req: UploadLogoInput): Promise<Space> {
    actor.assertOwner();
    const blob = await this.blobs.save(req.bytes, req.mime);
    return this.change(actor, req.version, (space) => space.setLogo(blob.hash));
  }

  removeLogo(actor: Actor, req: RemoveLogoInput): Promise<Space> {
    return this.change(actor, req.version, (space) => space.setLogo(null));
  }

  setHostedApps(actor: Actor, req: HostedAppsInput): Promise<Space> {
    return this.change(actor, req.version, (space) => space.allowHostedApps(req.on));
  }

  /** 주인만. 공간은 하나뿐이라 id 없이 잠근다. 나머지 순서는 EntityService.change와 같다 */
  private change(actor: Actor, version: number, apply: (space: Space) => void): Promise<Space> {
    actor.assertOwner();
    return this.transaction(async (tx) => {
      const spaces = new SpaceRepository(tx);
      const space = await spaces.lockCurrent();
      if (!space) throw new NotFound('블로그 공간부터 만들어 주세요 (설치 코드)');
      space.assertVersion(version);
      apply(space);
      await spaces.save(space);
      return space;
    });
  }
}
