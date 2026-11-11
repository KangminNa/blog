import { Forbidden, type SecretBox } from '../../platform';

// 재료 결과물 내려받기 표 (결과물 2차). 러너가 MCP(begin_download)로 받아 GET api/outputs/download의 머리글로 낸다.
// 올리기 표(UploadTicket)를 거울처럼 따른다: 기기 토큰은 REST에서 통하지 않고(ActorGuard), 파일 본문은 MCP의 JSON으로 보내지 않는다.
// 서버 키로 봉인하고(용도 고정, 10분), 그 작업 · 실행 · 결과물에 묶인다: 다른 결과물을 받는 데 쓸 수 없다.
export class DownloadTicket {
  static readonly HEADER = 'x-cairn-download';
  static readonly PATH = '/api/outputs/download';
  private static readonly PURPOSE = 'output-download';
  private static readonly TTL_SECONDS = 600;

  constructor(
    readonly spaceId: string,
    readonly taskId: string,
    readonly runId: string,
    readonly outputId: string,
  ) {}

  /** 봉인한 표 */
  seal(box: SecretBox, now: Date): string {
    return box.pack(
      DownloadTicket.PURPOSE,
      JSON.stringify([this.spaceId, this.taskId, this.runId, this.outputId]),
      DownloadTicket.TTL_SECONDS,
      now,
    );
  }

  /** now에 봉인한 표가 끝나는 때 */
  static expiresAt(now: Date): Date {
    return new Date(now.getTime() + DownloadTicket.TTL_SECONDS * 1000);
  }

  /** 표를 연다. 없거나 · 틀리거나 · 끝났거나 · 다른 용도면 403 */
  static open(box: SecretBox, token: string | null, now: Date): DownloadTicket {
    const value = box.unpack(DownloadTicket.PURPOSE, token, now);
    if (value === null)
      throw new Forbidden(
        'download_ticket',
        '내려받기 표가 맞지 않거나 끝났어요. 표를 다시 받아 주세요',
      );
    const [spaceId, taskId, runId, outputId] = JSON.parse(value) as [
      string,
      string,
      string,
      string,
    ];
    return new DownloadTicket(spaceId, taskId, runId, outputId);
  }
}
