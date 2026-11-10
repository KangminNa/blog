import { FileSniff } from '../../platform';

// 올릴 수 있는 사진인지 파일의 앞부분으로 판단한다. 요청 머리글은 보내는 쪽 마음대로라 믿지 않는다.
// PNG · JPEG · WebP · GIF만 받는다. SVG는 스크립트를 담을 수 있어서 받지 않는다. 알아보는 일은 platform의 FileSniff
// biome-ignore lint/complexity/noStaticOnlyClass: 상태 없는 판단 한 곳. 입력 검사와 테스트가 함께 쓴다
export class ImagePolicy {
  /** 받는 형식의 확장자 (보관 파일 이름) */
  static readonly EXTENSIONS: Readonly<Record<string, string>> = {
    [FileSniff.PNG]: 'png',
    [FileSniff.JPEG]: 'jpg',
    [FileSniff.WEBP]: 'webp',
    [FileSniff.GIF]: 'gif',
  };

  /** 받는 형식이면 그 mime, 아니면 null */
  static mimeOf(bytes: Buffer): string | null {
    const mime = FileSniff.mimeOf(bytes);
    return mime !== null && mime in ImagePolicy.EXTENSIONS ? mime : null;
  }
}
