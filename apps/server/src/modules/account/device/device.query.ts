import { Injectable } from '@nestjs/common';
import { Actor, BaseQuery, Database, DeviceActor, RuleViolation, SecretBox } from '../../platform';
import { SpaceQuery } from '../space/space.query';
import { AuthorizationPolicy } from './authorization.policy';
import { Device, DeviceCredential } from './device';
import type { AuthorizeRequest, ConsentRequest } from './device.request';
import { OAuthClientRepository } from './oauth-client.repository';

/** 기기 하나 (관리 화면의 기기 시트) */
export class DeviceView {
  constructor(
    readonly id: string,
    readonly name: string,
    readonly clientName: string,
    readonly scopes: readonly string[],
    readonly createdAt: Date,
    readonly lastUsedAt: Date | null,
    readonly revokedAt: Date | null,
    readonly version: number,
  ) {}
}

/** 승인 화면에 보일 것 */
export class ConsentView {
  constructor(
    readonly clientName: string,
    readonly redirectHost: string,
    readonly name: string,
    readonly scopes: readonly string[],
  ) {}
}

/** OAuth 안내 문서(메타데이터)를 만들 때 쓰는 주소들 */
export class OAuthAddressView {
  constructor(readonly siteUrl: string) {}

  get issuer(): string {
    return this.siteUrl;
  }

  get resource(): string {
    return `${this.siteUrl}/mcp`;
  }
}

// 기기 읽기: 토큰 → 요청자(Guard), 기기 목록, 승인 화면, 승인 요청을 어디로 보낼지, OAuth 주소.
@Injectable()
export class DeviceQuery extends BaseQuery {
  private readonly policy: AuthorizationPolicy;

  constructor(
    db: Database,
    private readonly spaces: SpaceQuery,
    box: SecretBox,
  ) {
    super(db);
    this.policy = new AuthorizationPolicy(box);
  }

  /** Guard가 부른다: 끊지 않은 기기의 살아 있는 토큰(OAuth access 또는 예비 기기 토큰)이면 기기, 아니면 null */
  async actorFor(token: string): Promise<DeviceActor | null> {
    const hash = DeviceCredential.hash(token);
    const [row] = await this.sql`
      SELECT d.id, d.space_id, d.scopes FROM account.devices d
      WHERE d.revoked_at IS NULL AND d.id IN (
        SELECT device_id FROM account.oauth_tokens
        WHERE token_hash = ${hash} AND kind = 'access' AND revoked_at IS NULL AND expires_at > now()
        UNION
        SELECT device_id FROM account.device_tokens
        WHERE token_hash = ${hash} AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now()))`;
    return row
      ? new DeviceActor(String(row.space_id), String(row.id), new Set(row.scopes as string[]))
      : null;
  }

  async list(actor: Actor): Promise<readonly DeviceView[]> {
    actor.assertCan(Actor.WRITE);
    const rows = await this.sql`
      SELECT d.*, (SELECT max(created_at) FROM account.oauth_tokens t WHERE t.device_id = d.id) AS last_used
      FROM account.devices d
      ORDER BY d.revoked_at IS NOT NULL, d.created_at DESC`;
    return rows.map(
      (r) =>
        new DeviceView(
          String(r.id),
          String(r.name),
          String(r.meta?.clientName ?? ''),
          (r.scopes as string[]) ?? [],
          new Date(r.created_at),
          r.last_used === null ? null : new Date(r.last_used),
          r.revoked_at === null ? null : new Date(r.revoked_at),
          Number(r.version),
        ),
    );
  }

  /** 주소들. 사이트 주소(블로그 정보)가 정해져 있어야 AI 도구가 찾아올 수 있다 */
  async addresses(actor: Actor): Promise<OAuthAddressView> {
    const { siteUrl } = await this.spaces.info(actor);
    if (!siteUrl) throw new RuleViolation('사이트 주소부터 정해 주세요 (관리 화면의 블로그 정보)');
    return new OAuthAddressView(siteUrl);
  }

  /** 승인 요청을 승인 화면으로 보낼 주소, 또는 오류를 붙여 돌려보낼 주소 */
  async authorizeRedirect(actor: Actor, req: AuthorizeRequest): Promise<string> {
    const { siteUrl } = await this.addresses(actor);
    const client = await new OAuthClientRepository(this.sql).find(req.clientId);
    return this.policy.redirectFor(siteUrl, client, req);
  }

  /** 승인 화면 (로그인한 주인만) */
  consent(actor: Actor, req: ConsentRequest): ConsentView {
    actor.assertCan(Actor.WRITE);
    return new ConsentView(
      req.clientName,
      new URL(req.redirectUri).host,
      req.name,
      Device.DEFAULT_SCOPES,
    );
  }

  /** 거절: 오류를 붙여 AI 도구에게 돌려보낼 주소 */
  deniedRedirect(actor: Actor, req: ConsentRequest): string {
    actor.assertCan(Actor.WRITE);
    return this.policy.deniedRedirect(req);
  }
}
