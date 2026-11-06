import { timingSafeEqual } from 'node:crypto';
import type { SecretBox } from '../../platform';

// 배포 서버 안의 러너가 사람 없이 연결해도 되는지 확인하는 규칙.
//   연결 값: 서버 키에서 만든다 (설치 코드와 같은 방식). 저장하지 않고, 서버가 시작할 때 서버와 러너만 보는
//   볼륨의 파일에 쓴다 (ServerRunnerGateway). 이 값을 가진 쪽은 그 볼륨을 본 러너뿐이다.
//   토큰은 디스크에 두지 않는다: 러너가 이 값을 내밀 때마다 서버가 서버 러너의 토큰을 새로 바꿔 준다.
// 서버 키를 바꾸면 연결 값도 바뀐다. 서버가 다시 뜰 때 파일을 새로 쓰고, 러너는 거절되면 파일을 다시 읽는다.
export class ServerRunnerPolicy {
  constructor(private readonly box: SecretBox) {}

  secret(): string {
    return this.box.derive('server-runner-pairing').toString('base64url');
  }

  matches(input: string): boolean {
    const given = Buffer.from(input);
    const expected = Buffer.from(this.secret());
    return given.length === expected.length && timingSafeEqual(given, expected);
  }
}
