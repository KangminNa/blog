import { Injectable } from '@nestjs/common';
import {
  type Actor,
  AttemptLimiter,
  BaseService,
  Database,
  NotFound,
  PasswordHasher,
  SystemActor,
  Unauthenticated,
} from '../../platform';
import { InstallPolicy } from '../space/install.policy';
import { SpaceQuery } from '../space/space.query';
import { Owner, WebSession } from './owner';
import { OwnerRepository } from './owner.repository';
import type { ChangePasswordRequest, CreateOwnerRequest, LoginRequest } from './owner.request';
import { PasswordPolicy } from './password.policy';

// 주인 계정과 로그인: 설치 때 계정 만들기, 아이디·비밀번호 로그인, 로그아웃, 비밀번호 바꾸기·다시 정하기.
// 비밀번호 계산(scrypt)은 느리게 만든 것이라 트랜잭션 밖에서 한다.
@Injectable()
export class OwnerService extends BaseService {
  private static readonly WRONG = '아이디나 비밀번호가 맞지 않아요';
  /** 틀린 로그인은 한 곳에서 1분에 10번, 한 아이디에 1분에 5번까지 (맞는 로그인은 세지 않음) */
  private readonly byPlace = new AttemptLimiter(10, 60_000);
  private readonly byLogin = new AttemptLimiter(5, 60_000);

  constructor(
    db: Database,
    private readonly spaces: SpaceQuery,
    private readonly install: InstallPolicy,
    private readonly passwords: PasswordPolicy,
    private readonly hasher: PasswordHasher,
  ) {
    super(db);
  }

  /** 설치 통행증을 가진 브라우저만, 아직 주인이 없을 때 한 번. 만든 계정으로 바로 로그인된다 */
  async create(
    actor: Actor,
    pass: string | null,
    req: CreateOwnerRequest,
    ip: string,
    userAgent: string,
  ): Promise<WebSession> {
    const spaceId = this.install.assertCanClaim(await this.spaces.installStatus(actor, pass));
    this.passwords.check(req.login, req.password);
    const hash = await this.hasher.hash(req.password);
    return this.transaction(async (tx) => {
      const owners = new OwnerRepository(tx);
      const owner = Owner.create(spaceId, req.login, hash);
      const session = owner.startSession(ip, userAgent, new Date());
      await owners.save(owner);
      return session;
    });
  }

  async login(req: LoginRequest, ip: string, userAgent: string): Promise<WebSession> {
    this.byPlace.check(ip);
    this.byLogin.check(req.login);
    const found = await new OwnerRepository(this.db.sql).findByLogin(req.login);
    // 아이디가 없어도 같은 계산을 해서, 응답 시간으로 아이디가 있는지 알 수 없게 한다
    const ok = await this.hasher.verify(req.password, found?.passwordHash ?? null);
    if (!found || !ok) {
      this.byPlace.fail(ip);
      this.byLogin.fail(req.login);
      throw new Unauthenticated(OwnerService.WRONG);
    }
    const rehash =
      found.passwordHash && this.hasher.needsRehash(found.passwordHash)
        ? await this.hasher.hash(req.password)
        : null;
    return this.transaction(async (tx) => {
      const owners = new OwnerRepository(tx);
      const owner = (await owners.findByLogin(req.login)) ?? found;
      if (rehash) owner.setPassword(rehash, null, true);
      const session = owner.startSession(ip, userAgent, new Date());
      await owners.save(owner);
      return session;
    });
  }

  async logout(actor: Actor, token: string | null): Promise<void> {
    if (actor.kind !== 'owner' || !token) throw new Unauthenticated('로그인이 필요해요');
    await this.transaction(async (tx) => {
      const owners = new OwnerRepository(tx);
      const owner = await owners.findBySession(WebSession.hash(token));
      if (!owner) return;
      owner.endSession(WebSession.hash(token));
      await owners.save(owner);
    });
  }

  /** 지금 비밀번호를 확인하고 바꾼다. 지금 로그인만 남기고 다른 로그인은 끝난다 */
  async changePassword(
    actor: Actor,
    token: string | null,
    req: ChangePasswordRequest,
  ): Promise<void> {
    if (actor.kind !== 'owner' || !token) throw new Unauthenticated('로그인이 필요해요');
    const tokenHash = WebSession.hash(token);
    const found = await new OwnerRepository(this.db.sql).findBySession(tokenHash);
    if (!found) throw new Unauthenticated('로그인이 필요해요');
    this.byLogin.check(found.login);
    if (!(await this.hasher.verify(req.current, found.passwordHash))) {
      this.byLogin.fail(found.login);
      throw new Unauthenticated('지금 비밀번호가 맞지 않아요');
    }
    this.passwords.check(found.login, req.next, 'next');
    const hash = await this.hasher.hash(req.next);
    await this.transaction(async (tx) => {
      const owners = new OwnerRepository(tx);
      const owner = await owners.findBySession(tokenHash);
      if (!owner) throw new Unauthenticated('로그인이 필요해요');
      owner.setPassword(hash, owner.session(tokenHash));
      await owners.save(owner);
    });
  }

  /** 명령줄(pnpm owner reset-password): 서버에 접속할 수 있는 사람 = 주인. 모든 로그인이 끝난다 */
  async resetPassword(actor: Actor, plain: string): Promise<Owner> {
    if (!(actor instanceof SystemActor))
      throw new Unauthenticated('비밀번호 다시 정하기는 서버 명령줄에서만 할 수 있어요');
    const found = await new OwnerRepository(this.db.sql).findOnly();
    if (!found) throw new NotFound('아직 주인 계정이 없어요. 설치 마법사부터 진행하세요');
    this.passwords.check(found.login, plain);
    const hash = await this.hasher.hash(plain);
    return this.transaction(async (tx) => {
      const owners = new OwnerRepository(tx);
      const owner = (await owners.findOnly()) ?? found;
      owner.setPassword(hash, null);
      await owners.save(owner);
      return owner;
    });
  }
}
