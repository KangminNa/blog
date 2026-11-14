import { FileSniff, RuleViolation } from '../../platform';

// 결과물의 규칙 한 곳: 이름, 종류 · 형식, 미리 보기를 열어도 되는 형식, 한도 (기획서 결정 2026-11-10).
// 형식은 파일의 앞부분(FileSniff)을 먼저 믿고, 앞부분에 표시가 없는 글자 파일 · 문서는 이름으로 정한다.
// 이름으로 정한 형식은 미리 보기를 열지 않는다: 늘 내려받기(attachment)라 HTML · SVG가 우리 주소에서 열리지 않는다.
// 한도: 파일 하나 · 실행 한 번은 고정, 공간 전체와 디스크 여유는 서버 설정(CAIRN_OUTPUTS_MAX_GB · CAIRN_DISK_RESERVE_GB).
export class OutputPolicy {
  static readonly FILE_MAX = 100 * 1024 * 1024;
  static readonly RUN_FILES_MAX = 200;
  static readonly RUN_BYTES_MAX = 1024 * 1024 * 1024;
  static readonly NAME_MAX = 120;
  static readonly KINDS = ['document', 'slides', 'sheet', 'image', 'video', 'other'] as const;
  static readonly OCTET = 'application/octet-stream';
  private static readonly GB = 1024 * 1024 * 1024;
  /** 디스크 200GB에서 OS · 이미지 · DB · 블로그 사진 몫을 남긴 값 */
  private static readonly DEFAULT_MAX_GB = 80;
  /** 결과물과 상관없이 늘 남기는 디스크: DB가 디스크가 차서 멈추지 않게 */
  private static readonly DEFAULT_RESERVE_GB = 20;
  /** 앞부분으로 알아본 형식 중 미리 보기(inline)를 열어도 되는 것 */
  private static readonly INLINE = new Set([
    FileSniff.PNG,
    FileSniff.JPEG,
    FileSniff.GIF,
    FileSniff.WEBP,
    FileSniff.PDF,
    FileSniff.MP4,
    FileSniff.WEBM,
  ]);
  /** 앞부분으로 알아본 형식의 종류 */
  private static readonly SNIFFED_KIND: Readonly<Record<string, string>> = {
    [FileSniff.PNG]: 'image',
    [FileSniff.JPEG]: 'image',
    [FileSniff.GIF]: 'image',
    [FileSniff.WEBP]: 'image',
    [FileSniff.PDF]: 'document',
    [FileSniff.MP4]: 'video',
    [FileSniff.WEBM]: 'video',
  };
  /** 확장자 → [종류, 형식]. 앞부분에 표시가 없거나 zip인 것 (docx · pptx · xlsx는 zip이다) */
  private static readonly BY_EXTENSION: Readonly<Record<string, readonly [string, string]>> = {
    html: ['document', 'text/html'],
    htm: ['document', 'text/html'],
    md: ['document', 'text/markdown'],
    txt: ['document', 'text/plain'],
    docx: ['document', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    hwp: ['document', 'application/x-hwp'],
    hwpx: ['document', 'application/hwp+zip'],
    pptx: ['slides', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
    key: ['slides', 'application/vnd.apple.keynote'],
    xlsx: ['sheet', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    csv: ['sheet', 'text/csv'],
    tsv: ['sheet', 'text/tab-separated-values'],
    svg: ['image', 'image/svg+xml'],
    mov: ['video', 'video/quicktime'],
  };

  constructor(
    /** 공간의 결과물을 모두 더한 한도 (휴지통 포함: 지울 때까지 디스크를 쓴다) */
    readonly maxBytes: number,
    /** 디스크에 늘 남길 바이트 */
    readonly reserveBytes: number,
  ) {}

  static fromEnv(env: Readonly<Record<string, string | undefined>> = process.env): OutputPolicy {
    const gb = (value: string | undefined, fallback: number) => {
      const parsed = value === undefined || value.trim() === '' ? fallback : Number(value);
      if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`GB 값이 틀려요: ${value}`);
      return Math.floor(parsed * OutputPolicy.GB);
    };
    return new OutputPolicy(
      gb(env.CAIRN_OUTPUTS_MAX_GB, OutputPolicy.DEFAULT_MAX_GB),
      gb(env.CAIRN_DISK_RESERVE_GB, OutputPolicy.DEFAULT_RESERVE_GB),
    );
  }

  /** 파일 이름: 1~120자, 경로 · 제어 문자 없이, 점으로 시작하지 않게 (러너가 폴더 바로 아래 파일만 올린다) */
  static assertName(name: string): void {
    if (
      name.length === 0 ||
      name.length > OutputPolicy.NAME_MAX ||
      name.startsWith('.') ||
      name !== name.trim() ||
      /[/\\]/.test(name) ||
      // biome-ignore lint/suspicious/noControlCharactersInRegex: 제어 문자를 거르는 것이 이 검사의 일이다
      /[\u0000-\u001f\u007f]/.test(name)
    )
      throw new RuleViolation(
        `파일 이름은 ${OutputPolicy.NAME_MAX}자까지, / \\ 와 제어 문자 없이, 점으로 시작하지 않아야 해요: ${JSON.stringify(name)}`,
      );
  }

  /** 종류. 앞부분으로 알아본 형식이 먼저다 */
  static kindOf(name: string, sniffed: string | null): string {
    if (sniffed !== null && OutputPolicy.SNIFFED_KIND[sniffed])
      return OutputPolicy.SNIFFED_KIND[sniffed] as string;
    return OutputPolicy.BY_EXTENSION[OutputPolicy.extension(name)]?.[0] ?? 'other';
  }

  /** 저장할 형식. zip은 이름이 더 자세하다 (docx · pptx · xlsx) */
  static mimeOf(name: string, sniffed: string | null): string {
    if (sniffed !== null && sniffed !== FileSniff.ZIP) return sniffed;
    return (
      OutputPolicy.BY_EXTENSION[OutputPolicy.extension(name)]?.[1] ?? sniffed ?? OutputPolicy.OCTET
    );
  }

  /**
   * 격리해서 열 수 있는 HTML인가 (이름으로, 2026-11-14). 발표 · 표 · 문서를 HTML로 내므로 콘솔에서 바로 연다.
   * 연 HTML은 AI가 만든 페이지처럼 다른 출처로 취급된다 (OutputFile.VIEW_CSP): 로그인 · 서버 API에 닿지 못한다
   */
  static canView(name: string): boolean {
    const ext = OutputPolicy.extension(name);
    return ext === 'html' || ext === 'htm';
  }

  /** 미리 보기(inline)를 열어도 되는 형식인가. 앞부분으로 알아본 그림 · PDF · 영상만 */
  static canInline(mime: string): boolean {
    return OutputPolicy.INLINE.has(mime);
  }

  /** 실행 한 번의 한도: 이미 올린 수 · 바이트에 이 파일을 더해도 되는가 */
  static assertRun(files: number, bytes: number, size: number): void {
    if (size > OutputPolicy.FILE_MAX)
      throw new RuleViolation(
        `결과물 파일 하나는 ${OutputPolicy.FILE_MAX / 1024 / 1024}MB까지예요`,
      );
    if (files + 1 > OutputPolicy.RUN_FILES_MAX)
      throw new RuleViolation(`실행 한 번에 결과물은 ${OutputPolicy.RUN_FILES_MAX}개까지예요`);
    if (bytes + size > OutputPolicy.RUN_BYTES_MAX)
      throw new RuleViolation(
        `실행 한 번에 결과물은 합쳐 ${OutputPolicy.RUN_BYTES_MAX / OutputPolicy.GB}GB까지예요`,
      );
  }

  /** 공간 전체 · 디스크: 지금 쓰는 바이트와 디스크 여유에 이 파일을 더해도 되는가 */
  assertRoom(usedBytes: number, freeBytes: number, size: number): void {
    if (usedBytes + size > this.maxBytes)
      throw new RuleViolation(
        `결과물 저장 공간(${OutputPolicy.gbText(this.maxBytes)})이 찼어요. 휴지통을 비우거나 한도를 늘려 주세요`,
      );
    if (freeBytes - size < this.reserveBytes)
      throw new RuleViolation(
        `서버 디스크 여유가 ${OutputPolicy.gbText(this.reserveBytes)}보다 적어져 받지 않아요 (DB를 지키려고 남겨 두는 몫)`,
      );
  }

  private static extension(name: string): string {
    const dot = name.lastIndexOf('.');
    return dot < 1 ? '' : name.slice(dot + 1).toLowerCase();
  }

  private static gbText(bytes: number): string {
    return `${Math.round((bytes / OutputPolicy.GB) * 10) / 10}GB`;
  }
}
