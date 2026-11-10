import { Forbidden, type SecretBox } from '../../platform';

// 결과물 올리기 표. 러너가 MCP(begin_upload)로 받아 PUT api/outputs/upload의 머리글(X-Cairn-Upload)로 낸다.
// AI 토큰은 /mcp에서만 요청자가 되므로(ActorGuard) 파일 본문은 이 표로 받는다: S3의 미리 서명한 주소와 같은 방식.
// 서버 키로 봉인하고(용도 고정, 10분), 그 작업 · 실행 · 이름 · 크기 · sha256에 묶인다: 다른 파일이나 큰 본문에는 쓸 수 없다.
// 주소가 아니라 머리글로 낸다: 프록시 · 접속 기록에 남지 않게.
export class UploadTicket {
  static readonly HEADER = 'x-cairn-upload';
  static readonly PATH = '/api/outputs/upload';
  private static readonly PURPOSE = 'output-upload';
  private static readonly TTL_SECONDS = 600;

  constructor(
    readonly spaceId: string,
    readonly taskId: string,
    readonly runId: string,
    readonly name: string,
    readonly size: number,
    readonly sha256: string,
  ) {}

  /** 봉인한 표 */
  seal(box: SecretBox, now: Date): string {
    return box.pack(
      UploadTicket.PURPOSE,
      JSON.stringify([this.spaceId, this.taskId, this.runId, this.name, this.size, this.sha256]),
      UploadTicket.TTL_SECONDS,
      now,
    );
  }

  /** now에 봉인한 표가 끝나는 때 */
  static expiresAt(now: Date): Date {
    return new Date(now.getTime() + UploadTicket.TTL_SECONDS * 1000);
  }

  /** 표를 연다. 없거나 · 틀리거나 · 끝났거나 · 다른 용도면 403 */
  static open(box: SecretBox, token: string | null, now: Date): UploadTicket {
    const value = box.unpack(UploadTicket.PURPOSE, token, now);
    if (value === null)
      throw new Forbidden(
        'upload_ticket',
        '올리기 표가 맞지 않거나 끝났어요. 표를 다시 받아 주세요',
      );
    const [spaceId, taskId, runId, name, size, sha256] = JSON.parse(value) as [
      string,
      string,
      string,
      string,
      number,
      string,
    ];
    return new UploadTicket(spaceId, taskId, runId, name, size, sha256);
  }
}
