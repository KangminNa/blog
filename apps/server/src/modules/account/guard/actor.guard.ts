import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Cookies, type HttpRequest } from '../../platform';
import { DeviceQuery } from '../device/device.query';
import { WebSession } from '../owner/owner';
import { OwnerQuery } from '../owner/owner.query';

// 모든 요청에서 요청자를 정한다: Bearer 토큰 → 기기(MCP), 로그인 쿠키 → 주인, 없으면 방문자.
// 누구인지만 정하고 막지 않는다. 막는 건 Service 첫 줄의 권한 확인이다 (/mcp는 기기가 아니면 401).
@Injectable()
export class ActorGuard implements CanActivate {
  constructor(
    private readonly owners: OwnerQuery,
    private readonly devices: DeviceQuery,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<HttpRequest>();
    const bearer = /^Bearer\s+(\S+)$/i.exec(String(request.headers.authorization ?? ''))?.[1];
    if (bearer) {
      request.actor = (await this.devices.actorFor(bearer)) ?? undefined;
      return true;
    }
    const token = Cookies.read(request, WebSession.COOKIE);
    if (token) request.actor = (await this.owners.actorFor(token)) ?? undefined;
    return true;
  }
}
