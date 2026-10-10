import { createHash } from 'node:crypto';

// 보관 형식(docs/보관형식.md)의 파일 하나. 경로와 내용만 가진다 (경계를 넘는 데이터).
// 각 모듈이 자기 데이터를 이 파일들로 만들고, 동기화 플러그인은 이 파일들을 그대로 옮긴다.
export class ArchiveFile {
  private static readonly PATH = /^(cairn\.json|(blog|vault|assets)\/[^\0]+)$/;

  private constructor(
    readonly path: string,
    readonly body: Buffer,
  ) {
    if (!ArchiveFile.PATH.test(path) || path.includes('..')) {
      throw new Error(`보관 형식 밖의 경로예요: ${path}`);
    }
  }

  static text(path: string, content: string): ArchiveFile {
    return new ArchiveFile(path, Buffer.from(content, 'utf8'));
  }

  static bytes(path: string, body: Buffer): ArchiveFile {
    return new ArchiveFile(path, body);
  }

  /** vault 파일인가 (private 저장소에만 보낸다) */
  isPrivateArea(): boolean {
    return this.path.startsWith('vault/');
  }

  /** git이 이 내용에 붙이는 이름 (blob sha1). 원격과 같은지 비교해 바뀐 파일만 보낸다 */
  gitSha(): string {
    return createHash('sha1').update(`blob ${this.body.length}\0`).update(this.body).digest('hex');
  }

  asText(): string {
    return this.body.toString('utf8');
  }
}
