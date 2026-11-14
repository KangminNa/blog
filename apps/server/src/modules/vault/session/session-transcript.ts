import { createHash } from 'node:crypto';
import { type Redaction, RuleViolation, type SensitivePolicy } from '../../platform';

// 세션의 원문 하나 (2차 4단계 모으기): 수집 훅 · 확장이 올린 대화 글. 사람 말 · AI 말 · 도구 이름만 남긴 글이다
// (도구 출력은 올리는 쪽이 뺀다). 판처럼 추가만 하고(session_transcripts), 같은 글이 다시 오면 쌓지 않는다.
// 민감정보는 쌓기 전에 지운다 (올리는 쪽도 한 번 지웠다). 노트는 서버 러너가 이 글로 쓴다:
// AI에게는 앞뒤를 남기고 가운데를 줄인 글을 준다 (forPrompt)
export class SessionTranscript {
  static readonly MAX = 1_000_000;
  /** AI에게 주는 글의 앞 · 뒤 길이 (가운데는 줄인다). 끝 쪽에 결론이 있어 더 남긴다 */
  private static readonly HEAD = 40_000;
  private static readonly TAIL = 80_000;
  /** 민감정보 무늬가 칸 이름을 받는다: 원문은 칸이 하나다 */
  private static readonly SECTION = 'transcript';

  private constructor(
    readonly text: string,
    readonly redactions: readonly Redaction[],
  ) {}

  /** 올라온 글에서 민감정보를 지운 원문. 비어 있으면 RuleViolation */
  static scrubbed(text: string, policy: SensitivePolicy): SessionTranscript {
    const [clean, found] = policy.scrub(SessionTranscript.SECTION, text.trim());
    if (!clean.trim()) throw new RuleViolation('원문이 비어 있어요');
    return new SessionTranscript(clean, found);
  }

  /** 쌓인 원문 (session_transcripts.text) */
  static restore(text: string): SessionTranscript {
    return new SessionTranscript(text, []);
  }

  /** 내용의 해시. 같으면 같은 원문이다 (`UNIQUE (session_id, content_hash)`) */
  get hash(): string {
    return createHash('sha256').update(this.text).digest('hex');
  }

  /** AI에게 줄 글: 길면 앞 · 뒤를 남기고 가운데를 줄였다고 적는다 */
  forPrompt(): string {
    const head = SessionTranscript.HEAD;
    const tail = SessionTranscript.TAIL;
    const { text } = this;
    if (text.length <= head + tail) return text;
    const cut = text.length - head - tail;
    return `${text.slice(0, head)}\n\n[… 가운데 ${cut}자 줄임 …]\n\n${text.slice(-tail)}`;
  }
}
