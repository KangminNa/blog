import { randomBytes, type ScryptOptions, scrypt, timingSafeEqual } from 'node:crypto';

// 비밀번호를 되돌릴 수 없는 값으로 바꾼다. 라이브러리 없이 Node 내장 scrypt.
// 저장값에 계산 강도(N·r·p)와 소금을 함께 적어, 강도를 올려도 옛 값을 확인할 수 있고 다음 로그인 때 다시 저장한다.
//   모양: scrypt$<log2 N>$<r>$<p>$<salt base64>$<hash base64>
export class PasswordHasher {
  private static readonly LOG_N = 15;
  private static readonly R = 8;
  private static readonly P = 1;
  private static readonly KEY_LENGTH = 64;
  /** 저장값이 없을 때도 같은 시간이 걸리게 하는 가짜 값 (아이디가 있는지 응답 시간으로 알 수 없게) */
  private static dummy: Promise<string> | null = null;

  async hash(plain: string): Promise<string> {
    const salt = randomBytes(16);
    const key = await PasswordHasher.derive(
      plain,
      salt,
      PasswordHasher.LOG_N,
      PasswordHasher.R,
      PasswordHasher.P,
    );
    return [
      'scrypt',
      PasswordHasher.LOG_N,
      PasswordHasher.R,
      PasswordHasher.P,
      salt.toString('base64'),
      key.toString('base64'),
    ].join('$');
  }

  /** 맞으면 true. stored가 없거나 모양이 틀려도 같은 일을 하고 false */
  async verify(plain: string, stored: string | null): Promise<boolean> {
    PasswordHasher.dummy ??= this.hash('cairn-dummy-password');
    const parts = (stored ?? (await PasswordHasher.dummy)).split('$');
    const [kind, logN, r, p, salt, key] = parts;
    if (kind !== 'scrypt' || !logN || !r || !p || !salt || !key) return false;
    const expected = Buffer.from(key, 'base64');
    const actual = await PasswordHasher.derive(
      plain,
      Buffer.from(salt, 'base64'),
      Number(logN),
      Number(r),
      Number(p),
    );
    return (
      stored !== null && actual.length === expected.length && timingSafeEqual(actual, expected)
    );
  }

  /** 지금 강도보다 약하게 저장된 값인가 (다음 로그인 때 다시 저장) */
  needsRehash(stored: string): boolean {
    const [, logN, r, p] = stored.split('$');
    return (
      Number(logN) < PasswordHasher.LOG_N ||
      Number(r) < PasswordHasher.R ||
      Number(p) < PasswordHasher.P
    );
  }

  private static derive(
    plain: string,
    salt: Buffer,
    logN: number,
    r: number,
    p: number,
  ): Promise<Buffer> {
    const options: ScryptOptions = { N: 2 ** logN, r, p, maxmem: 256 * 2 ** logN * r };
    return new Promise((done, fail) =>
      scrypt(plain.normalize('NFKC'), salt, PasswordHasher.KEY_LENGTH, options, (error, key) =>
        error ? fail(error) : done(key),
      ),
    );
  }
}
