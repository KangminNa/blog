import { BaseRequest } from '../base/base-request';

// 브라우저 푸시 입력의 모양 (7단계). 브라우저의 PushSubscription.toJSON() 모양 그대로 받는다.

/** POST /api/push/subscriptions: { endpoint, keys: { p256dh, auth } } */
export class SubscribePushInput extends BaseRequest {
  private constructor(
    readonly endpoint: string,
    readonly p256dh: string,
    readonly auth: string,
  ) {
    super();
  }

  static from(raw: unknown): SubscribePushInput {
    return BaseRequest.read(raw, (f) => {
      const keys = f.nested('keys');
      return new SubscribePushInput(
        f.text('endpoint', 2000),
        keys.text('p256dh', 200),
        keys.text('auth', 100),
      );
    });
  }
}

/** POST /api/push/subscriptions/delete · /api/push/test: { endpoint } */
export class PushEndpointInput extends BaseRequest {
  private constructor(readonly endpoint: string) {
    super();
  }

  static from(raw: unknown): PushEndpointInput {
    return BaseRequest.read(raw, (f) => new PushEndpointInput(f.text('endpoint', 2000)));
  }
}
