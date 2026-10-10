import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { type Actor, VisitorActor } from '../base/actor';

// Controller 메서드 인자로 요청자를 받는다: `status(@CurrentActor() actor: Actor)`
// Guard가 request.actor를 채운다. 없으면 방문자.
export const CurrentActor = createParamDecorator((_: unknown, context: ExecutionContext): Actor => {
  const request = context.switchToHttp().getRequest<{ actor?: Actor }>();
  return request.actor ?? new VisitorActor();
});
