import { RuleViolation } from '../../platform';

// 글 판 하나의 내용: 제목과 본문 md. 내용이 같으면 판을 새로 만들지 않는다.
// 본문은 md 원본 그대로 둔다. 가운데 정렬(::: center) 같은 블록 문법은 화면이 그린다.
export class PostContent {
  static readonly TITLE_MAX = 200;
  /** 한글 3바이트 기준으로 요청 본문 한도(512KB) 안에 들어가게 */
  static readonly BODY_MAX = 100_000;
  private static readonly EXCERPT = 160;

  private constructor(
    readonly title: string,
    readonly body: string,
  ) {}

  /** 사람이나 AI 도구가 쓴 내용. 제목 앞뒤 빈칸은 지우고, 줄바꿈은 \n으로 맞춘다 */
  static write(title: string, body: string): PostContent {
    const t = title.trim();
    if (!t) throw new RuleViolation('제목을 적어 주세요');
    if (t.length > PostContent.TITLE_MAX)
      throw new RuleViolation(`제목은 ${PostContent.TITLE_MAX}자까지예요`);
    if (body.length > PostContent.BODY_MAX)
      throw new RuleViolation(`본문은 ${PostContent.BODY_MAX.toLocaleString('en-US')}자까지예요`);
    return new PostContent(t, body.replace(/\r\n?/g, '\n'));
  }

  static restore(title: string, body: string): PostContent {
    return new PostContent(title, body);
  }

  sameAs(other: PostContent): boolean {
    return this.title === other.title && this.body === other.body;
  }

  /** 목록에 보일 앞부분: md 문법을 걷어 낸 본문 160자 */
  get excerpt(): string {
    const text = this.plainBody;
    return text.length > PostContent.EXCERPT ? `${text.slice(0, PostContent.EXCERPT)}…` : text;
  }

  /** 찾기용 글자 (posts.head_text): 제목 + 문법을 걷어 낸 본문 */
  get searchText(): string {
    return `${this.title}\n${this.plainBody}`;
  }

  /** 코드 블록·블록 문법 줄·구분선·사진·링크 주소·머리 기호를 걷어 낸 글자 */
  private get plainBody(): string {
    return this.body
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/^:{2,}.*$/gm, ' ')
      .replace(/^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/gm, ' ')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/^\s{0,3}(?:#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
      .replace(/\[![a-z]+\]/gi, '')
      .replace(/[*_`~]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
