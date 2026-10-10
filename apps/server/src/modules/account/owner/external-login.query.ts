import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  Actor,
  BaseQuery,
  Database,
  type LoginMethod,
  NotFound,
  PluginRegistry,
  RuleViolation,
  SecretBox,
} from '../../platform';
import { SpaceQuery } from '../space/space.query';
import { ExternalCallbackRequest, ExternalStartRequest } from './external-login.request';

/** 로그인 화면의 버튼 하나 */
export class LoginMethodView {
  constructor(
    readonly method: string,
    readonly label: string,
  ) {}
}

/** 주인에게 연결된 외부 계정 하나 (계정 시트) */
export class LoginLinkView {
  constructor(
    readonly method: string,
    readonly label: string,
    readonly linkedAt: Date,
  ) {}
}

/** 외부 로그인 시작: 그 서비스로 보낼 주소와, 이 브라우저에 줄 확인 쿠키 */
export class ExternalStartView {
  constructor(
    readonly url: string,
    readonly cookie: string,
  ) {}
}

// 외부 로그인 읽기: 켜진 로그인 방법(로그인 플러그인), 주인이 연결한 계정, 시작 주소 만들기.
@Injectable()
export class ExternalLoginQuery extends BaseQuery {
  constructor(
    db: Database,
    private readonly registry: PluginRegistry,
    private readonly spaces: SpaceQuery,
    private readonly box: SecretBox,
  ) {
    super(db);
  }

  methods(_actor: Actor): readonly LoginMethodView[] {
    return this.registry.logins().map((l) => new LoginMethodView(l.name, l.login.label));
  }

  async links(actor: Actor): Promise<readonly LoginLinkView[]> {
    actor.assertCan(Actor.WRITE);
    const rows = await this.sql`
      SELECT method, label, created_at FROM account.login_links WHERE user_id = ${actor.id}
      ORDER BY method`;
    return rows.map(
      (r) => new LoginLinkView(String(r.method), String(r.label ?? ''), new Date(r.created_at)),
    );
  }

  /** 연결(link)은 로그인한 주인만. 돌아올 주소는 사이트 주소 아래 /api/auth/login/<방법>/callback */
  async start(actor: Actor, req: ExternalStartRequest): Promise<ExternalStartView> {
    const method = this.method(req.method);
    if (req.mode === ExternalStartRequest.LINK) actor.assertCan(Actor.WRITE);
    const state = randomBytes(16).toString('base64url');
    return new ExternalStartView(
      method.login.start(await this.callbackUrl(actor, method.name), state),
      ExternalCallbackRequest.cookieFor(
        this.box,
        state,
        req,
        req.mode === ExternalStartRequest.LINK ? actor.id : null,
      ),
    );
  }

  method(name: string): LoginMethod {
    const found = this.registry.login(name);
    if (!found) throw new NotFound(`켜진 로그인 방법 중에 ${name}이(가) 없어요`);
    return found;
  }

  async callbackUrl(actor: Actor, method: string): Promise<string> {
    const { siteUrl } = await this.spaces.info(actor);
    if (!siteUrl)
      throw new RuleViolation(
        '사이트 주소가 아직 없어요. 관리 화면의 블로그 정보에서 먼저 정해 주세요',
      );
    return `${siteUrl}/api/auth/login/${method}/callback`;
  }
}
