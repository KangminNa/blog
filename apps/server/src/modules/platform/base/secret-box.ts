import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

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
