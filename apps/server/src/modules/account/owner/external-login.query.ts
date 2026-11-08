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
import { loginLinks } from '../account.schema';
import { SpaceQuery } from '../space/space.query';
import { ExternalCallbackInput, ExternalStartInput } from './external-login.input';
import {
  ExternalStartView,
  LoginLinkListView,
  LoginLinkView,
  LoginMethodListView,
  LoginMethodView,
} from './external-login.view';

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

  methods(_actor: Actor): LoginMethodListView {
    return new LoginMethodListView(
      this.registry.logins().map((l) => new LoginMethodView(l.name, l.login.label)),
    );
  }

  /** 주인 계정에 연결한 외부 로그인, 방법 이름 순서 */
  async links(actor: Actor): Promise<LoginLinkListView> {
    actor.assertOwner();
    const rows = await this.rows(loginLinks, { user_id: actor.id ?? '' }, { order: ['method'] });
    return new LoginLinkListView(rows.map((r) => new LoginLinkView(r)));
  }

  /** 연결(link)은 로그인한 주인만. 돌아올 주소는 사이트 주소 아래 /api/auth/login/<방법>/callback */
  async start(actor: Actor, req: ExternalStartInput): Promise<ExternalStartView> {
    const method = this.method(req.method);
    if (req.mode === ExternalStartInput.LINK) actor.assertOwner();
    const state = randomBytes(16).toString('base64url');
    return new ExternalStartView(
      method.login.start(await this.callbackUrl(actor, method.name), state),
      ExternalCallbackInput.cookieFor(
        this.box,
        state,
        req,
        req.mode === ExternalStartInput.LINK ? actor.id : null,
      ),
    );
  }

  method(name: string): LoginMethod {
    const found = this.registry.login(name);
    if (!found) throw new NotFound(`켜지 않은 로그인 방법이에요: ${name}`);
    return found;
  }

  async callbackUrl(actor: Actor, method: string): Promise<string> {
    const { siteUrl } = await this.spaces.info(actor);
    if (!siteUrl) throw new RuleViolation('사이트 주소부터 정해 주세요 (관리 화면의 블로그 정보)');
    return `${siteUrl}/api/auth/login/${method}/callback`;
  }
}
