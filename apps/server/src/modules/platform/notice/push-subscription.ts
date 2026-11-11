import { BaseEntity } from '../base/base-entity';
import { RuleViolation } from '../base/errors';
import type { PushSubscriptionNew, PushSubscriptionRow } from '../platform.tables';

// 브라우저 하나의 푸시 구독 (7단계). 브라우저가 pushManager.subscribe로 받은 주소(endpoint)와 키를 주인이 맡긴다.
// 서버는 이 주소로 직접 POST하므로, 알려진 푸시 서비스(https)만 받는다: 구독이 서버를 아무 주소에나 닿게 하는 길이 되지 않게.
// CAIRN_PUSH_EXTRA_ORIGINS(쉼표로 나눈 출처)는 시험과 직접 운영하는 푸시 서비스만을 위한 것이다.
export class PushSubscription extends BaseEntity {
  /** 브라우저들의 푸시 서비스 (호스트가 이것이거나 이것으로 끝난다) */
  static readonly SERVICES: readonly string[] = [
    'fcm.googleapis.com',
    'updates.push.services.mozilla.com',
    'push.apple.com',
    'notify.windows.com',
  ];
  /** 연속으로 이만큼 실패하면 지운다 */
  static readonly FAILS_MAX = 5;
  private static readonly ENDPOINT_MAX = 2000;
  private static readonly UA_MAX = 300;

  private constructor(private readonly row: PushSubscriptionNew) {
    super(row.id, 1);
  }

  /** 새 구독. 주소와 키의 모양을 본다 (키는 base64url: p256dh 65바이트, auth 16바이트) */
  static open(
    spaceId: string,
    userId: string,
    endpoint: string,
    p256dh: string,
    auth: string,
    userAgent: string | null,
    extraOrigins: readonly string[],
  ): PushSubscription {
    PushSubscription.assertEndpoint(endpoint, extraOrigins);
    if (Buffer.from(p256dh, 'base64url').length !== 65)
      throw new RuleViolation('브라우저의 공개 키(p256dh)가 맞지 않아요');
    if (Buffer.from(auth, 'base64url').length !== 16)
      throw new RuleViolation('브라우저의 auth가 맞지 않아요');
    return new PushSubscription({
      id: BaseEntity.newId(),
      space_id: spaceId,
      user_id: userId,
      endpoint,
      p256dh,
      auth,
      user_agent: userAgent?.slice(0, PushSubscription.UA_MAX) ?? null,
    });
  }

  /** CAIRN_PUSH_EXTRA_ORIGINS를 읽는다 (쉼표로 나눈 출처) */
  static extraOrigins(env: Readonly<Record<string, string | undefined>>): readonly string[] {
    return (env.CAIRN_PUSH_EXTRA_ORIGINS ?? '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);
  }

  /** 넣을 행 */
  get newRow(): PushSubscriptionNew {
    return this.row;
  }

  /** https의 알려진 푸시 서비스이거나, 따로 허락한 출처여야 한다 */
  private static assertEndpoint(endpoint: string, extraOrigins: readonly string[]): void {
    let url: URL;
    try {
      url = new URL(endpoint);
    } catch {
      throw new RuleViolation('푸시 주소가 URL이 아니에요');
    }
    if (endpoint.length > PushSubscription.ENDPOINT_MAX)
      throw new RuleViolation('푸시 주소가 너무 길어요');
    if (extraOrigins.includes(url.origin)) return;
    const known = PushSubscription.SERVICES.some(
      (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
    );
    if (url.protocol !== 'https:' || !known)
      throw new RuleViolation('알려진 브라우저 푸시 서비스의 https 주소만 받아요');
  }
}

/** 보낼 곳 하나 (일꾼이 읽는 구독 한 줄) */
export type PushTarget = Pick<PushSubscriptionRow, 'id' | 'endpoint' | 'p256dh' | 'auth'>;
