import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

/** 암호화된 값 하나 */
export class SealedSecret {
  constructor(
    readonly ciphertext: Buffer,
    readonly nonce: Buffer,
  ) {}
}

// 비밀값(토큰 등)을 서버 키로 암호화한다. AES-256-GCM, 값마다 새 nonce.
// 서버 키는 설치 때 한 번 만들어 환경 변수 CAIRN_SECRET_KEY(32바이트, base64)에 둔다. DB에는 키를 두지 않는다.
export class SecretBox {
  private constructor(private readonly key: Buffer | null) {}

  static fromEnv(env: Readonly<Record<string, string | undefined>>): SecretBox {
    const raw = env.CAIRN_SECRET_KEY?.trim();
    if (!raw) return new SecretBox(null);
    const key = Buffer.from(raw, 'base64');
    if (key.length !== 32)
      throw new Error(
        'CAIRN_SECRET_KEY는 32바이트를 base64로 적은 값이어야 해요 (pnpm secret:new)',
      );
    return new SecretBox(key);
  }

  /** 새 서버 키 (설치 때 한 번) */
  static newKey(): string {
    return randomBytes(32).toString('base64');
  }

  get ready(): boolean {
    return this.key !== null;
  }

  seal(plain: string): SealedSecret {
    const key = this.requireKey();
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final(), cipher.getAuthTag()]);
    return new SealedSecret(body, nonce);
  }

  /** 서버 키에서 용도별 값을 만든다 (예: 설치 코드). 같은 키·같은 이름이면 늘 같은 값 */
  derive(label: string): Buffer {
    return createHmac('sha256', this.requireKey()).update(`cairn:${label}`).digest();
  }

  /**
   * 짧게 쓰는 값을 암호화해 싼다 (승인 요청, 설치 통행증, 로그인 확인값). DB에 저장하지 않고 URL·쿠키로 주고받는다.
   * 만료 시각도 암호문 안에 넣어서, 받은 쪽은 내용도 만료도 볼 수 없고 고칠 수도 없다.
   * 모양: base64url(nonce 12바이트 · 암호문 · 확인값 16바이트). 서버 키에서 이 용도만의 키를 따로 만들어 쓴다.
   */
  pack(value: string, ttlSeconds: number, now: Date = new Date()): string {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.derive('pack'), nonce);
    const plain = `${Math.floor(now.getTime() / 1000) + ttlSeconds}.${value}`;
    const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return Buffer.concat([nonce, body, cipher.getAuthTag()]).toString('base64url');
  }

  /** 이 서버 키로 싼 값이고 만료 전이면 원래 값, 아니면 null */
  unpack(token: string | null, now: Date = new Date()): string | null {
    if (!token) return null;
    const raw = Buffer.from(token, 'base64url');
    if (raw.length < 12 + 16 + 2) return null;
    let plain: string;
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.derive('pack'), raw.subarray(0, 12));
      decipher.setAuthTag(raw.subarray(-16));
      plain = Buffer.concat([decipher.update(raw.subarray(12, -16)), decipher.final()]).toString(
        'utf8',
      );
    } catch {
      return null;
    }
    const dot = plain.indexOf('.');
    if (Number(plain.slice(0, dot)) * 1000 <= now.getTime()) return null;
    return plain.slice(dot + 1);
  }

  open(sealed: SealedSecret): string {
    const key = this.requireKey();
    const tag = sealed.ciphertext.subarray(-16);
    const body = sealed.ciphertext.subarray(0, -16);
    const decipher = createDecipheriv('aes-256-gcm', key, sealed.nonce);
    decipher.setAuthTag(tag);
    try {
      return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
    } catch {
      throw new Error('비밀값을 풀 수 없어요. 서버 키(CAIRN_SECRET_KEY)가 바뀌었는지 확인하세요');
    }
  }

  private requireKey(): Buffer {
    if (!this.key) throw new Error('서버 키(CAIRN_SECRET_KEY)가 없어 비밀값을 다룰 수 없어요');
    return this.key;
  }
}
