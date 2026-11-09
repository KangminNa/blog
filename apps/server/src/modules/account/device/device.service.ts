import { Injectable } from '@nestjs/common';
import {
  Actor,
  AttemptLimiter,
  Conflict,
  Database,
  EntityService,
  Forbidden,
  Idempotency,
  NotFound,
  RuleViolation,
  type Sql,
  TooManyRequests,
} from '../../platform';
import { SpaceQuery } from '../space/space.query';
import { AuthorizationCode } from './authorization-code';
import { Device, DeviceCredential } from './device';
import {
  type AddRunnerInput,
  type ConsentInput,
  type PairServerRunnerInput,
  type RegisterClientInput,
  type RevokeTokenInput,
  TokenInput,
  type UpdateDeviceInput,
} from './device.input';
import { DeviceRepository } from './device.repository';
import { OAuthClient } from './oauth-client';
import { OAuthClientRepository } from './oauth-client.repository';
import { OAuthError } from './oauth-error';
import { ServerRunnerPolicy } from './server-runner.policy';

// 기기 연결 쓰기 (MCP OAuth 2.1): 클라이언트 등록 → 주인 승인(코드) → 코드를 토큰으로(기기 생성) → 갱신 → 무효.
// 그리고 관리 화면의 기기 이름·권한 바꾸기, 끊기, 예비 기기 토큰.
@Injectable()
export class DeviceService extends EntityService<Device> {
  /** 스스로 등록은 한 곳(IP)에서 1시간에 20번까지 */
  private readonly registrations = new AttemptLimiter(20, 3_600_000);
  /** 서버 러너의 연결은 한 곳(IP)에서 1시간에 30번까지. 러너가 다시 뜰 때마다 한 번이라 넉넉하다 */
  private readonly pairings = new AttemptLimiter(30, 3_600_000);
  private static readonly ADD_RUNNER = 'add_runner';
  /** 하루가 지나도록 토큰을 한 번도 받지 않은 등록은 새 등록이 들어올 때 지운다 */
  private static readonly UNUSED_MS = 86_400_000;

  constructor(
    db: Database,
    private readonly spaces: SpaceQuery,
    private readonly serverRunner: ServerRunnerPolicy,
  ) {
    super(db);
  }

  protected store(tx: Sql): DeviceRepository {
    return new DeviceRepository(tx);
  }

  /**
   * 서버 러너가 연결 값을 내밀고 토큰을 받는다 (공개 경로: 연결 값이 곧 권한).
   * 서버 러너 기기는 공간마다 하나다. 없으면 만들고, 있으면 토큰을 바꾼다: 앞 토큰은 바로 무효.
   * 주인이 끊었으면 새로 만든다. 설치가 끝나기 전에는 409 (러너는 기다렸다 다시 묻는다)
   */
  async pairServerRunner(actor: Actor, req: PairServerRunnerInput, ip: string): Promise<Device> {
    this.pairings.hit(AttemptLimiter.place(ip));
    if (!this.serverRunner.matches(req.secret))
      throw new Forbidden('server_runner', '서버 러너의 연결 값이 맞지 않아요');
    const status = await this.spaces.installStatus(actor, null);
    if (!status.installed || !status.spaceId)
      throw new Conflict('설치가 끝나면 서버 러너가 연결돼요');
    const spaceId = status.spaceId;
    const now = new Date();
    return this.transaction(async (tx) => {
      const devices = new DeviceRepository(tx);
      const live = await devices.lockLiveByName(spaceId, Device.SERVER_RUNNER);
      if (live && !live.isServerRunner)
        throw new Conflict(
          `다른 기기가 "${Device.SERVER_RUNNER}" 이름을 쓰고 있어요. 그 기기의 이름을 바꿔 주세요`,
        );
      const device = live ?? Device.forServerRunner(spaceId, now);
      if (live) live.rotateDeviceToken(now);
      await devices.save(device);
      return device;
    });
  }

  /** AI 도구가 스스로 등록한다 (누구나). 설치가 끝난 블로그만, 한 곳에서 1시간에 20번까지 */
  async registerClient(actor: Actor, req: RegisterClientInput, ip: string): Promise<OAuthClient> {
    try {
      this.registrations.hit(AttemptLimiter.place(ip));
    } catch (error) {
      if (error instanceof TooManyRequests)
        throw new OAuthError('temporarily_unavailable', '잠시 뒤 다시 등록해 주세요', 429);
      throw error;
    }
    const status = await this.spaces.installStatus(actor, null);
    if (!status.installed || !status.spaceId)
      throw new OAuthError('invalid_client_metadata', '아직 설치가 끝나지 않은 블로그예요');
    const { hostedApps } = await this.spaces.info(actor);
    const client = OAuthClient.register(
      status.spaceId,
      req.clientName,
      req.redirectUris,
      hostedApps,
    );
    const before = new Date(Date.now() - DeviceService.UNUSED_MS);
    await this.transaction(async (tx) => {
      const clients = new OAuthClientRepository(tx);
      await clients.deleteUnused(before);
      await clients.save(client);
    });
    return client;
  }

  /** 주인이 승인 화면에서 "연결"을 누름 → 5분짜리 일회용 코드 (기기는 코드를 토큰으로 바꿀 때 생긴다) */
  async approve(actor: Actor, req: ConsentInput): Promise<AuthorizationCode> {
    actor.assertOwner();
    if (!actor.spaceId || !actor.id) throw new RuleViolation('로그인해 주세요');
    if (await new DeviceRepository(this.db.sql).nameTaken(actor.spaceId, req.name))
      throw new RuleViolation(
        `이미 쓰는 기기 이름이에요: ${req.name.trim()}. 다른 이름을 써 주세요`,
      );
    const code = AuthorizationCode.issue(
      req.clientId,
      req.redirectUri,
      req.codeChallenge,
      actor.spaceId,
      actor.id,
      req.name,
      req.clientName,
      new Date(),
    );
    await this.transaction(async (tx) => {
      const clients = new OAuthClientRepository(tx);
      if (!(await clients.find(req.clientId)))
        throw new NotFound('등록되지 않은 AI 도구예요. 다시 연결해 주세요');
      await clients.saveCode(code);
    });
    return code;
  }

  /** 토큰 받기: 승인 코드 → 새 기기와 토큰, 또는 갱신 토큰 → 새 토큰 (갱신 토큰은 한 번만 쓸 수 있다) */
  async token(req: TokenInput): Promise<Device> {
    return req.grantType === TokenInput.CODE ? this.redeem(req) : this.refresh(req);
  }

  /** AI 도구가 토큰을 버릴 때 (RFC 7009). 없는 토큰이어도 성공으로 답한다 */
  async revokeToken(req: RevokeTokenInput): Promise<void> {
    const hash = DeviceCredential.hash(req.token);
    await this.transaction(async (tx) => {
      const devices = new DeviceRepository(tx);
      const device = await devices.lockByAnyToken(hash);
      if (!device) return;
      device.retire(hash);
      await devices.save(device);
    });
  }

  /** 이름·권한 바꾸기. 본 version이 지금과 다르면 409 */
  update(actor: Actor, req: UpdateDeviceInput): Promise<Device> {
    return this.changeAsOwner(actor, req, (device) => device.edit(req.changes));
  }

  /** 끊기: 모든 토큰이 바로 무효. 기기 기록은 남는다 */
  revoke(actor: Actor, id: string): Promise<Device> {
    return this.changeAnyVersion(actor, id, (device) => device.revoke(new Date()));
  }

  /** 예비 기기 토큰: OAuth를 못 쓰는 도구용. 원문은 이번 응답에만 */
  issueDeviceToken(actor: Actor, id: string): Promise<Device> {
    return this.changeAnyVersion(actor, id, (device) => device.issueDeviceToken(new Date()));
  }

  /**
   * 러너 추가: run 권한만 가진 기기와 토큰을 콘솔에서 바로 만든다. 원문은 이번 응답에만.
   * 같은 requestId가 다시 오면 처음 만든 기기를 돌려준다 (토큰은 다시 볼 수 없어 예비 토큰을 새로 만든다).
   */
  async addRunner(actor: Actor, req: AddRunnerInput): Promise<Device> {
    actor.assertOwner();
    const { spaceId, id: userId } = actor;
    if (!spaceId || !userId) throw new RuleViolation('로그인해 주세요');
    return this.transaction(async (tx) => {
      const devices = new DeviceRepository(tx);
      const once = new Idempotency(tx, userId, req.requestId, DeviceService.ADD_RUNNER);
      const before = await once.previous();
      const first = before ? await devices.lockOrNull(spaceId, String(before.deviceId)) : null;
      if (first) return first;
      const device = Device.forRunner(spaceId, userId, req.name, new Date());
      await devices.save(device);
      await once.remember({ deviceId: device.id });
      return device;
    });
  }

  private async redeem(req: TokenInput): Promise<Device> {
    const now = new Date();
    return this.transaction(async (tx) => {
      const clients = new OAuthClientRepository(tx);
      const code = await clients.lockCode(AuthorizationCode.hash(req.code ?? ''));
      if (!code)
        throw new OAuthError('invalid_grant', '승인 코드가 맞지 않거나, 이미 썼거나, 만료됐어요');
      code.redeem(req.clientId, req.redirectUri ?? '', req.codeVerifier ?? '', now);
      await clients.saveCode(code);
      const device = code.connect(now);
      device.issueTokens(now);
      await new DeviceRepository(tx).save(device);
      return device;
    });
  }

  private async refresh(req: TokenInput): Promise<Device> {
    const now = new Date();
    const hash = DeviceCredential.hash(req.refreshToken ?? '');
    const reused = await this.transaction(async (tx) => {
      const devices = new DeviceRepository(tx);
      const device = await devices.lockByRefresh(hash);
      if (!device || device.revoked || (req.clientId && req.clientId !== device.clientId))
        throw new OAuthError('invalid_grant', '맞지 않거나 끊긴 기기의 갱신 토큰이에요');
      if (device.refreshWasReused()) {
        // 이미 쓴 갱신 토큰이 다시 왔다 = 누군가 훔쳐 먼저 썼을 수 있다. 기기를 끊고 저장한 뒤 거절한다
        device.revoke(now);
        await devices.save(device);
        return null;
      }
      device.refresh(now);
      await devices.save(device);
      return device;
    });
    if (!reused)
      throw new OAuthError(
        'invalid_grant',
        '이미 쓴 갱신 토큰이에요. 안전을 위해 이 기기의 연결을 끊었어요. 다시 연결해 주세요',
      );
    return reused;
  }

  /** 화면이 version을 보내지 않는 관리 일 (끊기, 예비 기기 토큰). 주인만 */
  private changeAnyVersion(
    actor: Actor,
    id: string,
    apply: (device: Device) => void,
  ): Promise<Device> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    return this.transaction(async (tx) => {
      const devices = this.store(tx);
      const device = await devices.lock(spaceId, id);
      apply(device);
      await devices.save(device);
      return device;
    });
  }
}
