import { Injectable } from '@nestjs/common';
import { BaseGateway } from '../base/base-gateway';
import { SecretBox } from '../base/secret-box';
import { WebPush } from '../base/web-push';
import type { PushMessage } from './notice.policy';
import type { PushTarget } from './push-subscription';

// 브라우저 푸시 서비스로 보내기 (7단계). 내용을 받는 브라우저의 키로 감싸고(RFC 8291) 서버 키에서 만든 VAPID로 서명해(RFC 8292)
// 구독 주소에 POST한다. 트랜잭션 밖에서 부른다. 푸시 서비스의 답 코드를 돌려준다 (닿지 못하면 0).
@Injectable()
export class PushGateway extends BaseGateway {
  protected readonly name = '브라우저 푸시';
  protected override readonly timeoutMs = 15_000;
  /** 브라우저가 꺼져 있을 때 푸시 서비스가 들고 있는 시간 */
  private static readonly TTL_SECONDS = 24 * 60 * 60;
  private push: WebPush | null = null;

  constructor(private readonly box: SecretBox) {
    super();
  }

  /** 서버 키에서 만든 VAPID 키 (서버 키가 바뀌면 바뀐다) */
  get keys(): WebPush {
    this.push ??= WebPush.fromSeed(this.box.derive('web-push-vapid'));
    return this.push;
  }

  /** 하나를 보낸다. 2xx면 받은 것, 404 · 410이면 사라진 구독, 0이면 닿지 못함 */
  async send(target: PushTarget, message: PushMessage, now: Date): Promise<number> {
    const body = WebPush.encrypt(message.payload(), target.p256dh, target.auth);
    try {
      return await this.call(async (signal) => {
        const res = await fetch(target.endpoint, {
          method: 'POST',
          headers: {
            authorization: this.keys.authorization(target.endpoint, PushGateway.subject(), now),
            'content-encoding': 'aes128gcm',
            'content-type': 'application/octet-stream',
            ttl: String(PushGateway.TTL_SECONDS),
            urgency: 'high',
          },
          body,
          signal,
          redirect: 'manual',
        });
        await res.body?.cancel();
        return res.status;
      });
    } catch {
      return 0;
    }
  }

  /** VAPID의 연락처: 웹 주소가 https면 그 주소, 아니면 이름만 있는 mailto */
  private static subject(): string {
    const web = process.env.CAIRN_WEB_URL ?? '';
    return web.startsWith('https://') ? web : 'mailto:push@cairn.invalid';
  }
}
