// 올릴 수 있는 사진인지 파일의 앞부분으로 판단한다. 요청 머리글은 보내는 쪽 마음대로라 믿지 않는다.
// PNG · JPEG · WebP · GIF만 받는다. SVG는 스크립트를 담을 수 있어서 받지 않는다.
// biome-ignore lint/complexity/noStaticOnlyClass: 상태 없는 판단 한 곳. 입력 검사와 테스트가 함께 쓴다
export class ImagePolicy {
  private static readonly PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  private static readonly JPEG = Buffer.from([0xff, 0xd8, 0xff]);

  /** 받는 형식이면 그 mime, 아니면 null */
  static mimeOf(bytes: Buffer): string | null {
    if (bytes.subarray(0, 8).equals(ImagePolicy.PNG)) return 'image/png';
    if (bytes.subarray(0, 3).equals(ImagePolicy.JPEG)) return 'image/jpeg';
    const head = bytes.subarray(0, 12).toString('latin1');
    if (head.startsWith('GIF87a') || head.startsWith('GIF89a')) return 'image/gif';
    if (head.startsWith('RIFF') && head.slice(8) === 'WEBP') return 'image/webp';
    return null;
  }
}
