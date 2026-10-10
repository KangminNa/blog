import { timingSafeEqual } from 'node:crypto';
import { Conflict, type SecretBox, Unauthenticated } from '../../platform';
import type { InstallStatusView } from './space.query';

// 처음 설치할 때 "서버를 가진 사람"인지 확인하는 규칙.
//   설치 코드: 서버 키에서 만든다. 저장하지 않고, 서버 로그와 `pnpm install-code`로만 볼 수 있다.
//   설치 통행증: 코드를 맞히면 10분 동안 쓰는 서명한 쿠키. 이걸 가진 브라우저만 주인 계정을 만들 수 있다.
// 주인이 정해지면 둘 다 쓸모가 없어진다.
export class InstallPolicy {
  static readonly COOKIE = 'cairn_install';
  static readonly PASS_SECONDS = 600;
  private static readonly ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  constructor(private readonly box: SecretBox) {}

  /** 사람이 옮겨 적기 쉬운 8글자 (헷갈리는 0·O·1·I는 뺌), 예: K7QF-2M9X */
  code(): string {
    const bytes = this.box.derive('install-code');
    const chars = [...bytes.subarray(0, 8)].map(
      (b) => InstallPolicy.ALPHABET[b % InstallPolicy.ALPHABET.length],
    );
    return `${chars.slice(0, 4).join('')}-${chars.slice(4).join('')}`;
  }

  matches(input: string): boolean {
    const given = Buffer.from(InstallPolicy.normalize(input));
    const expected = Buffer.from(InstallPolicy.normalize(this.code()));
    return given.length === expected.length && timingSafeEqual(given, expected);
  }

  issuePass(spaceId: string): string {
    return this.box.sign(`install:${spaceId}`, InstallPolicy.PASS_SECONDS);
  }

  isValidPass(pass: string | null, spaceId: string | null): boolean {
    return spaceId !== null && this.box.verify(pass) === `install:${spaceId}`;
  }

  /** 주인 계정을 만들어도 되는가: 아직 주인이 없고, 설치 통행증을 가진 브라우저일 때만. 공간 id를 돌려준다 */
  assertCanClaim(status: InstallStatusView): string {
    if (status.installed)
      throw new Conflict('이미 주인이 있는 블로그예요. 주인 계정으로 로그인해 주세요');
    if (!status.passValid || !status.spaceId)
      throw new Unauthenticated(
        '설치 코드부터 다시 넣어 주세요 (확인한 지 10분이 지났거나 확인 전)',
      );
    return status.spaceId;
  }

  private static normalize(value: string): string {
    return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  }
}
