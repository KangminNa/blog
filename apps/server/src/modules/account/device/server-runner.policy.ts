import { timingSafeEqual } from 'node:crypto';
import type { SecretBox } from '../../platform';

// 배포 서버 안의 러너가 사람 없이 연결해도 되는지 확인하는 규칙.
//   연결 값: 서버 키에서 만든다 (설치 코드와 같은 방식). 저장하지 않고, 서버가 시작할 때 서버와 러너만 보는
//   볼륨의 파일에 쓴다 (ServerRunnerGateway). 이 값을 가진 쪽은 그 볼륨을 본 러너뿐이다.
//   토큰은 디스크에 두지 않는다: 러너가 이 값을 내밀 때마다 서버가 서버 러너의 토큰을 새로 바꿔 준다.
// 서버 키를 바꾸면 연결 값도 바뀐다. 서버가 다시 뜰 때 파일을 새로 쓰고, 러너는 거절되면 파일을 다시 읽는다.
// 코드 러너 칸(docs/코드작업.md)은 값과 볼륨을 따로 둔다: 칸이 서버 러너로 붙어 브라우저 작업을 받거나,
// 서버 러너가 칸으로 붙어 셸 있는 일을 받지 못하게.
export class ServerRunnerPolicy {
  private static readonly SERVER = 'server-runner-pairing';
  private static readonly CODE = 'code-runner-pairing';

  constructor(private readonly box: SecretBox) {}

  /** 서버 러너의 연결 값 */
  secret(): string {
    return this.derive(ServerRunnerPolicy.SERVER);
  }

  matches(input: string): boolean {
    return ServerRunnerPolicy.same(input, this.secret());
  }

  /** 코드 러너 칸의 연결 값 (칸 모두가 같은 값, 칸 번호는 따로 알린다) */
  codeSecret(): string {
    return this.derive(ServerRunnerPolicy.CODE);
  }

  matchesCode(input: string): boolean {
    return ServerRunnerPolicy.same(input, this.codeSecret());
  }

  private derive(purpose: string): string {
    return this.box.derive(purpose).toString('base64url');
  }

  private static same(input: string, secret: string): boolean {
    const given = Buffer.from(input);
    const expected = Buffer.from(secret);
    return given.length === expected.length && timingSafeEqual(given, expected);
  }
}
