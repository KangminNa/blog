import { Injectable } from '@nestjs/common';
import {
  Actor,
  AttemptLimiter,
  BaseService,
  Conflict,
  Database,
  Forbidden,
  NotFound,
} from '../../platform';
import { InstallPolicy } from './install.policy';
import { Space } from './space';
import { SpaceQuery } from './space.query';
import { SpaceRepository } from './space.repository';
import type { InstallCodeRequest, RenameSpaceRequest } from './space.request';

// 공간 쓰기: 설치 코드 확인(공간 만들기), 블로그 이름·소개·사이트 주소 바꾸기.
@Injectable()
export class SpaceService extends BaseService {
  /** 설치 코드는 한 곳에서 1분에 5번까지 */
  private readonly attempts = new AttemptLimiter(5, 60_000);

  constructor(
    db: Database,
    private readonly install: InstallPolicy,
    private readonly spaces: SpaceQuery,
  ) {
    super(db);
  }

  /** 설치 코드가 맞으면 공간을 만들고(없을 때) 10분짜리 설치 통행증을 돌려준다. from: 요청한 곳(IP) */
  async verifyInstallCode(actor: Actor, req: InstallCodeRequest, from: string): Promise<string> {
    this.attempts.hit(from);
    if (!this.install.matches(req.code)) throw new Forbidden('install', '맞지 않는 설치 코드예요');
    if ((await this.spaces.installStatus(actor, null)).installed)
      throw new Conflict('이미 설치된 블로그예요. 주인 계정으로 로그인해 주세요');
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

  async rename(actor: Actor, req: RenameSpaceRequest): Promise<Space> {
    actor.assertCan(Actor.WRITE);
    return this.transaction(async (tx) => {
      const repo = new SpaceRepository(tx);
      const space = await repo.lockCurrent();
      if (!space) throw new NotFound('블로그 공간부터 만들어 주세요 (설치 코드)');
      space.assertVersion(req.version);
      space.rename(req.name, req.description, req.siteUrl);
      await repo.save(space);
      return space;
    });
  }
}
