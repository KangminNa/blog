// 파일의 앞부분으로 형식을 알아본다. 요청 머리글이나 이름은 보내는 쪽 마음대로라 믿지 않는다.
// 무엇을 받을지는 쓰는 쪽이 정한다 (blog의 사진은 이미지 넷만, task의 결과물은 미리 보기를 열지만).
// 글자 파일(txt · md · csv)이나 SVG · HTML처럼 앞부분에 표시가 없는 것은 알아보지 않는다 (null).
// biome-ignore lint/complexity/noStaticOnlyClass: 상태 없는 판단 한 곳. blog와 task가 함께 쓴다
export class FileSniff {
  /** 알아보는 데 필요한 앞부분의 길이 */
  static readonly HEAD_BYTES = 16;
  static readonly PNG = 'image/png';
  static readonly JPEG = 'image/jpeg';
  static readonly GIF = 'image/gif';
  static readonly WEBP = 'image/webp';
  static readonly PDF = 'application/pdf';
  static readonly MP4 = 'video/mp4';
  static readonly WEBM = 'video/webm';
  /** docx · pptx · xlsx도 zip이다. 무엇인지는 이름으로만 안다 */
  static readonly ZIP = 'application/zip';

  private static readonly PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  private static readonly JPEG_HEAD = Buffer.from([0xff, 0xd8, 0xff]);
  private static readonly WEBM_HEAD = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);
  private static readonly ZIP_HEAD = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

  /** 알아본 형식의 mime, 모르면 null */
  static mimeOf(bytes: Buffer): string | null {
    if (bytes.subarray(0, 8).equals(FileSniff.PNG_HEAD)) return FileSniff.PNG;
    if (bytes.subarray(0, 3).equals(FileSniff.JPEG_HEAD)) return FileSniff.JPEG;
    if (bytes.subarray(0, 4).equals(FileSniff.WEBM_HEAD)) return FileSniff.WEBM;
    if (bytes.subarray(0, 4).equals(FileSniff.ZIP_HEAD)) return FileSniff.ZIP;
    const head = bytes.subarray(0, FileSniff.HEAD_BYTES).toString('latin1');
    if (head.startsWith('GIF87a') || head.startsWith('GIF89a')) return FileSniff.GIF;
    if (head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP') return FileSniff.WEBP;
    if (head.startsWith('%PDF-')) return FileSniff.PDF;
    // ISO 기본 미디어 파일: 4바이트 길이 뒤에 ftyp. QuickTime(qt)은 브라우저가 못 여는 것이 많아 뺀다
    if (head.slice(4, 8) === 'ftyp' && head.slice(8, 12) !== 'qt  ') return FileSniff.MP4;
    return null;
  }
}
