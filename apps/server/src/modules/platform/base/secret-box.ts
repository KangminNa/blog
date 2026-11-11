import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

/** 암호화된 값 하나 */
export class SealedSecret {
  constructor(
    readonly ciphertext: Buffer,
    readonly nonce: Buffer,
  ) {}
}

// 비밀값(토큰 등)을 서버 키로 암호화한다. AES-256-GCM, 값마다 새 nonce.
// 서버 키는 설치 때 만들어 환경 변수 CAIRN_SECRET_KEY(32바이트, base64)에 둔다. DB에는 키를 두지 않는다.
// 키를 바꾸는 동안에는 옛 키를 CAIRN_SECRET_KEY_OLD에 함께 둔다. 옛 키로는 저장된 비밀값을 읽기만 하고,
// 암호화와 derive·pack은 늘 지금 키로 한다. 그래서 키를 바꾸면 설치 코드가 바뀌고 이미 싼 값은 풀리지 않는다 (짧게 쓰는 값이라 괜찮다).
export class SecretBox {
  private static readonly CANNOT_OPEN =
    '비밀값을 풀 수 없어요. 서버 키(CAIRN_SECRET_KEY)가 바뀌었다면 옛 키를 CAIRN_SECRET_KEY_OLD에 넣어 주세요';

  private constructor(
    private readonly key: Buffer | null,
    private readonly oldKey: Buffer | null,
  ) {}

  static fromEnv(env: Readonly<Record<string, string | undefined>>): SecretBox {
    const key = SecretBox.readKey(env, 'CAIRN_SECRET_KEY');
    const oldKey = SecretBox.readKey(env, 'CAIRN_SECRET_KEY_OLD');
    if (oldKey && !key)
      throw new Error('CAIRN_SECRET_KEY_OLD만 있어요. 새 키를 CAIRN_SECRET_KEY에 넣어 주세요');
    return new SecretBox(key, oldKey);
  }

  private static readKey(
    env: Readonly<Record<string, string | undefined>>,
    name: string,
  ): Buffer | null {
    const raw = env[name]?.trim();
    if (!raw) return null;
    const key = Buffer.from(raw, 'base64');
    if (key.length !== 32)
      throw new Error(`${name}는 32바이트를 base64로 적은 값이어야 해요 (pnpm secret:new)`);
    return key;
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
   * 짧게 쓰는 값을 암호화해 싼다 (승인 요청, 설치 통행증, 로그인 확인값, 작업 토큰). DB에 저장하지 않고 URL·쿠키로 주고받는다.
   * 만료 시각도 암호문 안에 넣어서, 받은 쪽은 내용도 만료도 볼 수 없고 고칠 수도 없다.
   * purpose(용도)도 암호문 안에 넣고, 풀 때 같은 용도일 때만 돌려준다: 모든 용도가 같은 열쇠라
   * 용도를 적지 않으면 한 자리에서 받은 값(예: 승인 요청)이 다른 자리(예: 로그인 쿠키)에서 풀린다.
   * 모양: base64url(nonce 12바이트 · 암호문 · 확인값 16바이트). 서버 키에서 이 용도만의 키를 따로 만들어 쓴다.
   */
  pack(purpose: string, value: string, ttlSeconds: number, now: Date = new Date()): string {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.derive('pack'), nonce);
    const plain = `${Math.floor(now.getTime() / 1000) + ttlSeconds}.${SecretBox.purposeOf(purpose)}${value}`;
    const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return Buffer.concat([nonce, body, cipher.getAuthTag()]).toString('base64url');
  }

  /** 이 서버 키로 이 용도로 싼 값이고 만료 전이면 원래 값, 아니면 null */
  unpack(purpose: string, token: string | null, now: Date = new Date()): string | null {
    const opened = this.openPacked(token, now);
    const head = SecretBox.purposeOf(purpose);
    return opened?.startsWith(head) ? opened.slice(head.length) : null;
  }

  /** 용도 표시: 이름 뒤에 줄바꿈. 이름에는 줄바꿈이 없어서 값이 다른 용도의 이름으로 시작해도 섞이지 않는다 */
  private static purposeOf(purpose: string): string {
    if (!/^[a-z][a-z0-9-]*(?::[a-z0-9-]+)?$/.test(purpose))
      throw new Error(`싸는 값의 용도 이름이 틀렸어요: ${purpose}`);
    return `${purpose}\n`;
  }

  private openPacked(token: string | null, now: Date): string | null {
    if (!token) return null;
    const raw = Buffer.from(token, 'base64url');
    // Buffer는 base64의 틀린 글자 · 남는 끝 글자를 조용히 버린다: 고친 토큰이 같은 바이트로 풀리지 않게 그대로 다시 맞춰 본다
    if (raw.toString('base64url') !== token) return null;
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

  /** 지금 키로 풀고, 안 되면 옛 키로 푼다 */
  open(sealed: SealedSecret): string {
    const key = this.requireKey();
    const plain = SecretBox.tryOpen(sealed, key) ?? this.openWithOldKey(sealed);
    if (plain === null) throw new Error(SecretBox.CANNOT_OPEN);
    return plain;
  }

  /**
   * 옛 키로 잠긴 값을 지금 키로 다시 잠근다. 이미 지금 키로 잠겼으면 null (다시 돌려도 안전하다).
   * 어느 키로도 풀리지 않으면 오류: 값을 버리지 않도록 호출한 쪽의 트랜잭션을 되돌린다.
   */
  reseal(sealed: SealedSecret): SealedSecret | null {
    if (SecretBox.tryOpen(sealed, this.requireKey()) !== null) return null;
    const plain = this.openWithOldKey(sealed);
    if (plain === null) throw new Error(SecretBox.CANNOT_OPEN);
    return this.seal(plain);
  }

  /** 이 키로 잠긴 값이면 원래 값, 아니면 null. 인증 태그가 맞아야 풀리므로 틀린 키가 틀린 값을 내놓지 않는다 */
  private static tryOpen(sealed: SealedSecret, key: Buffer): string | null {
    const tag = sealed.ciphertext.subarray(-16);
    const body = sealed.ciphertext.subarray(0, -16);
    const decipher = createDecipheriv('aes-256-gcm', key, sealed.nonce);
    decipher.setAuthTag(tag);
    try {
      return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
    } catch {
      return null;
    }
  }

  private openWithOldKey(sealed: SealedSecret): string | null {
    return this.oldKey ? SecretBox.tryOpen(sealed, this.oldKey) : null;
  }

  private requireKey(): Buffer {
    if (!this.key) throw new Error('서버 키(CAIRN_SECRET_KEY)가 없어 비밀값을 다룰 수 없어요');
    return this.key;
  }
}
