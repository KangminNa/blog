import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Cookies, Forbidden, type HttpRequest, SystemActor } from '../../platform';
import { DeviceQuery } from '../device/device.query';
import { WebSession } from '../owner/owner';
import { OwnerQuery } from '../owner/owner.query';
import { SpaceQuery } from '../space/space.query';

// 모든 요청에서 요청자를 정한다: Bearer 토큰 → 기기(MCP), 로그인 쿠키 → 주인, 없으면 방문자.
// 누구인지 정하는 것 말고 막는 일은 하나뿐이다: 로그인 쿠키로 오는 쓰기 요청의 출처 확인.
// 그 밖의 권한은 Service 첫 줄에서 확인한다 (/mcp는 기기가 아니면 401).
@Injectable()
export class ActorGuard implements CanActivate {
  private static readonly READS = new Set(['GET', 'HEAD', 'OPTIONS']);

  constructor(
    private readonly owners: OwnerQuery,
    private readonly devices: DeviceQuery,
    private readonly spaces: SpaceQuery,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<HttpRequest>();
    const bearer = /^Bearer\s+(\S+)$/i.exec(String(request.headers.authorization ?? ''))?.[1];
    if (bearer) {
      request.actor = (await this.devices.actorFor(bearer)) ?? undefined;
      return true;
    }
    const token = Cookies.read(request, WebSession.COOKIE);
    if (!token) return true;
    if (!ActorGuard.READS.has(request.method.toUpperCase())) await this.assertSameSite(request);
    request.actor = (await this.owners.actorFor(token)) ?? undefined;
    return true;
  }

  /**
   * 다른 사이트가 주인의 로그인 쿠키로 몰래 보내는 쓰기 요청을 막는다.
   *   Sec-Fetch-Site가 cross-site면 막는다 (요즘 브라우저는 늘 붙인다).
   *   Origin이 있으면 사이트 주소(정하기 전이면 이 요청이 온 주소)와 같아야 한다.
   *   Origin이 없으면 브라우저가 보낸 요청이 아니다 (브라우저는 다른 출처로 쓰기를 보낼 때 늘 Origin을 붙인다).
   */
  private async assertSameSite(request: HttpRequest): Promise<void> {
    const fetchSite = String(request.headers['sec-fetch-site'] ?? '');
    const origin = request.headers.origin;
    if (fetchSite !== 'cross-site' && typeof origin !== 'string') return;
    const { siteUrl } = await this.spaces.info(new SystemActor());
    const expected = siteUrl ? [new URL(siteUrl).origin] : ActorGuard.selfOrigins(request);
    if (fetchSite !== 'cross-site' && typeof origin === 'string' && expected.includes(origin))
      return;
    throw new Forbidden(
      'origin',
      siteUrl
        ? `사이트 주소(${siteUrl})로 연 화면에서만 바꿀 수 있어요`
        : '이 블로그에서 연 화면에서만 바꿀 수 있어요',
    );
  }

  /**
   * 사이트 주소를 정하기 전(설치 중)에 쓰는 "이 요청이 온 주소". 앞의 프록시(웹 서버 포함)가 넘긴 원래 주소도 본다.
   * 다른 사이트의 화면은 이 머리글들을 붙여 보낼 수 없다 (브라우저가 미리 묻기(preflight)에서 막는다).
   */
  private static selfOrigins(request: HttpRequest): string[] {
    const first = (value: unknown) =>
      String(value ?? '')
        .split(',')[0]
        ?.trim() ?? '';
    const proto = first(request.headers['x-forwarded-proto']) || request.protocol;
    return [first(request.headers['x-forwarded-host']), first(request.headers.host)]
      .filter(Boolean)
      .map((host) => `${proto}://${host}`);
  }
}
