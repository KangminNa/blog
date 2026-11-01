import { createHash } from 'node:crypto';
import { RuleViolation } from '../base/errors';
import { ZipLimits, ZipReader } from '../base/zip-reader';

// 보관 형식(docs/보관형식.md)의 파일 하나. 경로와 내용만 가진다 (경계를 넘는 데이터).
// 각 모듈이 자기 데이터를 이 파일들로 만들고, 동기화 플러그인은 이 파일들을 그대로 옮긴다.
export class ArchiveFile {
  private static readonly PATH = /^(cairn\.json|(blog|vault|assets)\/[^\0]+)$/;
  /** 따옴표 없이 쓸 수 있는 YAML 글자: 글자로 시작하고 기호가 뜻을 갖지 않는 것 */
  private static readonly PLAIN = /^\p{L}[\p{L}\p{N} _./-]*(?<![ ])$/u;
  private static readonly RESERVED = /^(?:null|true|false|yes|no|on|off|y|n)$/i;
  /** 쌓인 내용을 담는 경로. 나머지(cairn.json, 빈 카테고리 목록, 빈 선 목록)만 있으면 빈 Cairn이다 */
  private static readonly CONTENT = /^(?:vault\/wikis|vault\/sessions|blog\/posts|assets)\//;
  /** 모르는 앞부분 키를 보관하는 meta 칸 */
  private static readonly META_KEY = 'frontmatter';

  private constructor(
    readonly path: string,
    readonly body: Buffer,
    private readonly kept = false,
  ) {
    if (!ArchiveFile.PATH.test(path) || path.includes('..')) {
      throw new RuleViolation(`보관 형식 밖의 경로예요: ${path}`);
    }
  }

  static text(path: string, content: string): ArchiveFile {
    return new ArchiveFile(path, Buffer.from(content, 'utf8'));
  }

  static bytes(path: string, body: Buffer): ArchiveFile {
    return new ArchiveFile(path, body);
  }

  /** zip을 풀어 보관 파일로. 형식 밖의 경로와 위험한 이름, 한도를 넘는 묶음은 거절한다 */
  static unzip(zip: Buffer, limits: ZipLimits = ZipLimits.DEFAULT): readonly ArchiveFile[] {
    return [...ZipReader.read(zip, limits)].map(([path, body]) => new ArchiveFile(path, body));
  }

  /**
   * 앞부분(frontmatter)과 본문으로 된 md. 앞부분은 옵시디언 속성과 맞게 평평한 키만 쓴다.
   * kept: 복원 때 보관한 모르는 키 (적힌 글자 그대로 맨 뒤에 돌려준다)
   */
  static markdown(
    path: string,
    head: Readonly<Record<string, unknown>>,
    body: string,
    kept: Readonly<Record<string, string>> = {},
  ): ArchiveFile {
    const lines = [
      ...Object.entries(head).map(([key, value]) => `${key}: ${ArchiveFile.yaml(value)}`),
      ...Object.entries(kept).map(([key, raw]) => `${key}:${raw}`),
    ];
    return ArchiveFile.text(path, `---\n${lines.join('\n')}\n---\n\n${body}`);
  }

  /** 행의 meta에 보관할 값. 모르는 키가 없으면 빈 값. jsonb는 객체의 키 순서를 바꾸므로 [키, 글자] 쌍의 목록으로 둔다 */
  static metaOf(kept: Readonly<Record<string, string>>): Record<string, unknown> {
    const pairs = Object.entries(kept);
    return pairs.length === 0 ? {} : { [ArchiveFile.META_KEY]: pairs };
  }

  /** 행의 meta에서 꺼낸 모르는 키들 */
  static keptIn(meta: unknown): Readonly<Record<string, string>> {
    const pairs = (meta as Record<string, unknown> | null)?.[ArchiveFile.META_KEY];
    return Object.fromEntries((pairs ?? []) as [string, string][]);
  }

  /** 쌓인 내용이 든 경로인가 (세션·wiki·글·사진) */
  static holdsContent(path: string): boolean {
    return ArchiveFile.CONTENT.test(path);
  }

  /** 항목 목록을 담은 yml (예: vault/categories.yml). 값은 평평하다 */
  static yamlList(path: string, items: readonly Readonly<Record<string, unknown>>[]): ArchiveFile {
    if (items.length === 0) return ArchiveFile.text(path, '[]\n');
    const blocks = items.map((item) =>
      Object.entries(item)
        .map(([key, value], i) => `${i === 0 ? '- ' : '  '}${key}: ${ArchiveFile.yaml(value)}`)
        .join('\n'),
    );
    return ArchiveFile.text(path, `${blocks.join('\n')}\n`);
  }

  /** 값 하나를 YAML로. 문자열 따옴표는 JSON과 같다 (YAML은 JSON 문자열을 그대로 읽는다) */
  private static yaml(value: unknown): string {
    if (value === null || value === undefined) return 'null';
    if (value instanceof Date) return JSON.stringify(value.toISOString());
    if (Array.isArray(value)) return `[${value.map((v) => ArchiveFile.yaml(v)).join(', ')}]`;
    if (typeof value !== 'string') return JSON.stringify(value);
    const plain = ArchiveFile.PLAIN.test(value) && !ArchiveFile.RESERVED.test(value);
    return plain ? value : JSON.stringify(value);
  }

  /** 공개 저장소로 보내면 안 되는 파일로 표시한다 (임시 글, 공개 글에 쓰이지 않는 사진). 공개 여부는 파일을 만드는 모듈이 안다 */
  keptPrivate(): ArchiveFile {
    return new ArchiveFile(this.path, this.body, true);
  }

  /** private 저장소에만 보낼 파일인가: vault 전부와 공개되지 않은 글·사진 */
  isPrivateArea(): boolean {
    return this.kept || this.path.startsWith('vault/');
  }

  /** git이 이 내용에 붙이는 이름 (blob sha1). 원격과 같은지 비교해 바뀐 파일만 보낸다 */
  gitSha(): string {
    return createHash('sha1').update(`blob ${this.body.length}\0`).update(this.body).digest('hex');
  }

  asText(): string {
    return this.body.toString('utf8');
  }
}
