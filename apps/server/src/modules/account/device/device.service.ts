import { Injectable } from '@nestjs/common';
import { Actor, BaseService, Database, NotFound, RuleViolation } from '../../platform';
import { SpaceQuery } from '../space/space.query';
import { AuthorizationCode } from './authorization-code';
import { Device, DeviceCredential } from './device';
import { DeviceRepository } from './device.repository';
import {
  type ConsentRequest,
  type RegisterClientRequest,
  type RevokeTokenRequest,
  TokenRequest,
  type UpdateDeviceRequest,
} from './device.request';
import { OAuthClient } from './oauth-client';
import { OAuthClientRepository } from './oauth-client.repository';
import { OAuthError } from './oauth-error';

// 기기 연결 쓰기 (MCP OAuth 2.1): 클라이언트 등록 → 주인 승인(코드) → 코드를 토큰으로(기기 생성) → 갱신 → 무효.
// 그리고 관리 화면의 기기 이름·권한 바꾸기, 끊기, 예비 기기 토큰.
@Injectable()
export class DeviceService extends BaseService {
  constructor(
    db: Database,
    private readonly spaces: SpaceQuery,
  ) {
    super(db);
  }

  /** AI 도구가 스스로 등록한다 (누구나). 설치가 끝난 블로그만 */
  async registerClient(actor: Actor, req: RegisterClientRequest): Promise<OAuthClient> {
    const status = await this.spaces.installStatus(actor, null);
    if (!status.installed || !status.spaceId)
      throw new OAuthError('invalid_client_metadata', '아직 설치가 끝나지 않은 블로그예요');
    const client = OAuthClient.register(status.spaceId, req.clientName, req.redirectUris);
    await this.transaction((tx) => new OAuthClientRepository(tx).save(client));
    return client;
  }

  /** 주인이 승인 화면에서 "연결"을 누름 → 5분짜리 일회용 코드 (기기는 코드를 토큰으로 바꿀 때 생긴다) */
  async approve(actor: Actor, req: ConsentRequest): Promise<AuthorizationCode> {
    actor.assertCan(Actor.WRITE);
    if (!actor.spaceId || !actor.id) throw new RuleViolation('주인 계정으로 로그인해 주세요');
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
  async token(req: TokenRequest): Promise<Device> {
    return req.grantType === TokenRequest.CODE ? this.redeem(req) : this.refresh(req);
  }

  /** AI 도구가 토큰을 버릴 때 (RFC 7009). 없는 토큰이어도 성공으로 답한다 */
  async revokeToken(req: RevokeTokenRequest): Promise<void> {
    const hash = DeviceCredential.hash(req.token);
    await this.transaction(async (tx) => {
      const devices = new DeviceRepository(tx);
      const device = await devices.lockByAnyToken(hash);
      if (!device) return;
      device.retire(hash);
      await devices.save(device);
    });
  }

  async update(actor: Actor, id: string, req: UpdateDeviceRequest): Promise<Device> {
    return this.change(actor, id, (device) => {
      device.assertVersion(req.version);
      if (req.name !== null) device.rename(req.name);
      if (req.scopes !== null) device.grant(req.scopes);
    });
  }

  /** 끊기: 모든 토큰이 바로 무효. 기기 기록은 남는다 */
  async revoke(actor: Actor, id: string): Promise<Device> {
    return this.change(actor, id, (device) => device.revoke(new Date()));
  }

  /** 예비 기기 토큰: OAuth를 못 쓰는 도구용. 원문은 이번 응답에만 */
  async issueDeviceToken(actor: Actor, id: string): Promise<Device> {
    return this.change(actor, id, (device) => device.issueDeviceToken(new Date()));
  }

  private async redeem(req: TokenRequest): Promise<Device> {
    const now = new Date();
    return this.transaction(async (tx) => {
      const clients = new OAuthClientRepository(tx);
      const code = await clients.lockCode(AuthorizationCode.hash(req.code ?? ''));
      if (!code)
        throw new OAuthError('invalid_grant', '승인 코드가 맞지 않거나, 이미 썼거나, 만료됐어요');
      code.redeem(req.clientId, req.redirectUri ?? '', req.codeVerifier ?? '', now);
      await clients.saveCode(code);
      const device = Device.connect(
        code.spaceId,
        code.userId,
        code.deviceName,
        code.clientId,
        code.clientName,
        now,
      );
      device.issueTokens(now);
      await new DeviceRepository(tx).save(device);
      return device;
    });
  }

  private async refresh(req: TokenRequest): Promise<Device> {
    const now = new Date();
    const hash = DeviceCredential.hash(req.refreshToken ?? '');
    const reused = await this.transaction(async (tx) => {
      const devices = new DeviceRepository(tx);
      const device = await devices.lockByRefresh(hash);
      if (!device || device.revokedAt || (req.clientId && req.clientId !== device.clientId))
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

  private async change(actor: Actor, id: string, apply: (device: Device) => void): Promise<Device> {
    actor.assertCan(Actor.WRITE);
    return this.transaction(async (tx) => {
      const devices = new DeviceRepository(tx);
      const device = await devices.lock(id);
      if (!device || device.spaceId !== actor.spaceId) throw new NotFound('기기를 찾을 수 없어요');
      apply(device);
      await devices.save(device);
      return device;
    });
  }
}
