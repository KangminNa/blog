import {
  createCipheriv,
  createECDH,
  createHash,
  createPrivateKey,
  hkdfSync,
  type KeyObject,
  randomBytes,
  sign,
} from 'node:crypto';

// 웹 푸시 (7단계). 외부 서비스 없이 서버 키로 브라우저 푸시를 보낸다. 라이브러리 없이 node:crypto만 쓴다 (2026-11-11 결정).
//   RFC 8291: 내용 암호화 (aes128gcm). 받는 브라우저의 공개 키(p256dh)와 auth로 한 번 쓰는 키를 만들어 감싼다
//   RFC 8292: VAPID. 서버가 보냈다는 것을 서버의 P-256 키로 서명한 JWT로 밝힌다
// 서버의 VAPID 키는 서버 키에서 만든다 (따로 저장하지 않는다). 서버 키를 바꾸면 공개 키가 바뀌어 구독이 끊긴다:
// 콘솔이 공개 키가 다른 구독을 보고 "다시 켜기"를 띄운다.
export class WebPush {
  /** P-256의 차수 n. 개인 키 d는 1 ≤ d < n */
  private static readonly ORDER = BigInt(
    '0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551',
  );
  private static readonly RECORD_SIZE = 4096;
  private static readonly TAG = 16;
  /** JWT의 유효 시간 (RFC 8292는 24시간 이하) */
  private static readonly JWT_SECONDS = 12 * 60 * 60;

  private constructor(
    /** 공개 키 (비압축 65바이트) */
    readonly publicKey: Buffer,
    private readonly signer: KeyObject,
  ) {}

  /** 서버 키에서 만든 32바이트로 VAPID 키 쌍을 만든다. 차수 범위 밖이면 해시를 한 번 더 */
  static fromSeed(seed: Buffer): WebPush {
    let d = Buffer.from(seed);
    for (;;) {
      const value = BigInt(`0x${d.toString('hex')}`);
      if (value > 0n && value < WebPush.ORDER) break;
      d = createHash('sha256').update(d).digest();
    }
    const ecdh = createECDH('prime256v1');
    ecdh.setPrivateKey(d);
    const publicKey = ecdh.getPublicKey();
    const signer = createPrivateKey({
      key: {
        kty: 'EC',
        crv: 'P-256',
        d: d.toString('base64url'),
        x: publicKey.subarray(1, 33).toString('base64url'),
        y: publicKey.subarray(33, 65).toString('base64url'),
      },
      format: 'jwk',
    });
    return new WebPush(publicKey, signer);
  }

  /** 브라우저의 pushManager.subscribe에 줄 공개 키 (base64url) */
  get publicKeyText(): string {
    return this.publicKey.toString('base64url');
  }

  /**
   * Authorization 머리글: vapid t=<JWT>, k=<공개 키>. aud는 푸시 서비스의 출처, sub는 연락처(mailto: · https:)
   */
  authorization(endpoint: string, subject: string, now: Date): string {
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const unsigned = `${encode({ typ: 'JWT', alg: 'ES256' })}.${encode({
      aud: new URL(endpoint).origin,
      exp: Math.floor(now.getTime() / 1000) + WebPush.JWT_SECONDS,
      sub: subject,
    })}`;
    const signature = sign('sha256', Buffer.from(unsigned), {
      key: this.signer,
      dsaEncoding: 'ieee-p1363',
    });
    return `vapid t=${unsigned}.${signature.toString('base64url')}, k=${this.publicKeyText}`;
  }

  /**
   * RFC 8291 내용 암호화. 받는 쪽의 공개 키(p256dh)와 auth(16바이트)로 감싼 본문 (레코드 하나).
   * salt와 보내는 쪽 키는 시험에서만 정해 넘긴다 (RFC의 예와 맞춰 보려고)
   */
  static encrypt(
    plaintext: Buffer,
    receiverKey: string,
    authSecret: string,
    salt: Buffer = randomBytes(16),
    senderPrivate: Buffer | null = null,
  ): Buffer {
    const uaPublic = Buffer.from(receiverKey, 'base64url');
    const auth = Buffer.from(authSecret, 'base64url');
    if (uaPublic.length !== 65 || uaPublic[0] !== 4)
      throw new Error('받는 쪽 공개 키가 P-256 비압축 키가 아니에요');
    if (auth.length !== 16) throw new Error('auth는 16바이트예요');
    if (plaintext.length + 1 + WebPush.TAG > WebPush.RECORD_SIZE)
      throw new Error('푸시 내용이 너무 커요');
    const sender = createECDH('prime256v1');
    if (senderPrivate) sender.setPrivateKey(senderPrivate);
    else sender.generateKeys();
    const asPublic = sender.getPublicKey();
    const shared = sender.computeSecret(uaPublic);
    const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
    const ikm = Buffer.from(hkdfSync('sha256', shared, auth, keyInfo, 32));
    const cek = Buffer.from(
      hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16),
    );
    const nonce = Buffer.from(
      hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12),
    );
    const cipher = createCipheriv('aes-128-gcm', cek, nonce);
    // 마지막 레코드: 내용 뒤에 0x02 (채움 없음)
    const body = Buffer.concat([
      cipher.update(Buffer.concat([plaintext, Buffer.from([2])])),
      cipher.final(),
      cipher.getAuthTag(),
    ]);
    const header = Buffer.alloc(16 + 4 + 1);
    salt.copy(header, 0);
    header.writeUInt32BE(WebPush.RECORD_SIZE, 16);
    header.writeUInt8(asPublic.length, 20);
    return Buffer.concat([header, asPublic, body]);
  }
}
