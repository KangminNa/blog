import type { AiStream } from './ai-tool';
import { Json } from './json';
import { PlanWindow, RunEvent } from './progress';

// claude -p --output-format stream-json의 줄을 실행 기록으로 바꾼다. 한 줄 = JSON 객체 하나.
//   system(init)  →  붙은 MCP 서버를 본다
//   assistant     →  tool_use마다 read·write. 글은 마지막 답으로 기억한다
//   user          →  실패한 tool_result는 error
//   result        →  마지막 답과 남은 토큰. 실패면 error
//   rate_limit_event → 구독 사용률. 기록이 아니라 가장 최근 값만 기억한다
//
// 토큰: input + cache_creation + output. cache_read는 값이 매우 싸고 턴마다 다시 세어져 한도에 넣지 않는다.
// assistant 줄은 내용 블록마다 하나씩 나오고 같은 message.id에 같은 usage를 싣는다. 그래서 id별로 늘어난 만큼만 센다.
// 하위 에이전트까지 든 정확한 합은 result의 modelUsage에 있어서, 끝에서 모자란 만큼을 더한다.
export class ClaudeStream implements AiStream {
  /** 허락한 단 하나의 MCP 서버 */
  static readonly SERVER = 'cairn';
  private static readonly SERVER_PREFIX = `mcp__${ClaudeStream.SERVER}__`;
  private static readonly READ_TOOLS: ReadonlySet<string> = new Set([
    'Read',
    'Glob',
    'Grep',
    'WebFetch',
    'WebSearch',
    'search_sessions',
    'get_session',
    'neighbors',
    'blog_get_post',
  ]);
  /** tool_use 입력에서 대상으로 보여 줄 칸. 내용은 남기지 않는다 */
  private static readonly TARGETS = ['file_path', 'path', 'pattern', 'query', 'url'];

  private readonly countedByMessage = new Map<string, number>();
  private counted = 0;
  /** 아직 어느 기록에도 싣지 않은 토큰 */
  private owed = 0;
  private lastText = '';
  private resultText: string | null = null;
  private failureText: string | null = null;
  private strayServers: readonly string[] = [];
  private planWindows: readonly PlanWindow[] = [];

  /** 마지막 답 */
  get finalText(): string {
    return this.resultText ?? this.lastText;
  }

  /** CLI가 실패로 끝냈다면 그 이유 */
  get failure(): string | null {
    return this.failureText;
  }

  /** 허락하지 않은 MCP 서버 이름들. 있으면 격리가 깨진 것이다 */
  get stray(): readonly string[] {
    return this.strayServers;
  }

  get breach(): string | null {
    return this.strayServers.length > 0
      ? `허락하지 않은 MCP 서버: ${this.strayServers.join(', ')}`
      : null;
  }

  /** 가장 최근에 본 구독 사용률을 꺼낸다. 새로 본 것이 없으면 비어 있다 */
  takePlanUsage(): readonly PlanWindow[] {
    const windows = this.planWindows;
    this.planWindows = [];
    return windows;
  }

  /** 한 줄을 읽는다. JSON이 아니거나 모르는 줄은 넘어간다 */
  read(line: string): readonly RunEvent[] {
    const event = Json.parse(line);
    if (event === null) return [];
    switch (event.text('type')) {
      case 'system':
        return this.system(event);
      case 'assistant':
        return this.assistant(event);
      case 'user':
        return this.user(event);
      case 'result':
        return this.result(event);
      case 'rate_limit_event':
        return this.rateLimit(event);
      default:
        return [];
    }
  }

  /** 끝까지 읽은 뒤 어느 기록에도 싣지 못한 토큰 (도중에 멈춘 실행) */
  finish(): readonly RunEvent[] {
    return this.owed > 0 ? [new RunEvent(RunEvent.READ, '', this.takeOwed())] : [];
  }

  private system(event: Json): readonly RunEvent[] {
    const subtype = event.text('subtype');
    if (subtype === 'api_retry') {
      const tries = `${event.number('attempt')}/${event.number('max_retries')}`;
      return [new RunEvent(RunEvent.ERROR, `API 재시도 ${tries}: ${event.text('error')}`, 0)];
    }
    if (subtype !== 'init') return [];
    const servers = event.list('mcp_servers');
    this.strayServers = servers
      .map((server) => server.text('name'))
      .filter((name) => name !== ClaudeStream.SERVER);
    const broken = servers.filter(
      (server) => server.text('name') === ClaudeStream.SERVER && server.text('status') === 'failed',
    );
    return broken.length > 0 ? [new RunEvent(RunEvent.ERROR, 'cairn MCP에 붙지 못했어요', 0)] : [];
  }

  private assistant(event: Json): readonly RunEvent[] {
    const message = event.child('message');
    this.count(message);
    const events: RunEvent[] = [];
    for (const block of message.list('content')) {
      if (block.text('type') === 'text') {
        this.lastText = block.text('text') || this.lastText;
      } else if (block.text('type') === 'tool_use') {
        const name = block.text('name');
        const kind = ClaudeStream.kindOf(name);
        events.push(
          new RunEvent(kind, ClaudeStream.describe(name, block.child('input')), this.takeOwed()),
        );
      }
    }
    return events;
  }

  private user(event: Json): readonly RunEvent[] {
    return event
      .child('message')
      .list('content')
      .filter((block) => block.text('type') === 'tool_result' && block.flag('is_error'))
      .map((block) => new RunEvent(RunEvent.ERROR, ClaudeStream.resultBody(block), 0));
  }

  private result(event: Json): readonly RunEvent[] {
    this.settle(event);
    const text = event.text('result');
    if (event.flag('is_error') || event.text('subtype').startsWith('error')) {
      this.failureText = text || event.texts('errors').join('\n') || event.text('subtype');
      return [new RunEvent(RunEvent.ERROR, this.failureText, this.takeOwed())];
    }
    this.resultText = text || this.lastText;
    return [new RunEvent(RunEvent.RESULT, this.resultText, this.takeOwed())];
  }

  /** 쓸 수 있는 창이 하나도 없으면 앞의 값을 지킨다 */
  private rateLimit(event: Json): readonly RunEvent[] {
    const windows = PlanWindow.listFrom(event.child('rate_limit_info'));
    if (windows.length > 0) this.planWindows = windows;
    return [];
  }

  /** assistant 줄의 usage에서 이 메시지가 늘어난 만큼만 센다 */
  private count(message: Json): void {
    const usage = message.child('usage');
    const tokens = ClaudeStream.tokensOf(
      usage.number('input_tokens'),
      usage.number('cache_creation_input_tokens'),
      usage.number('output_tokens'),
    );
    const id = message.text('id');
    const before = id ? (this.countedByMessage.get(id) ?? 0) : 0;
    if (id) this.countedByMessage.set(id, Math.max(before, tokens));
    this.owe(Math.max(0, tokens - before));
  }

  /** result의 합계와 비교해 모자란 토큰을 더한다 */
  private settle(event: Json): void {
    const models = event.child('modelUsage').values();
    const usage = event.child('usage');
    const total =
      models.length > 0
        ? models.reduce(
            (sum, model) =>
              sum +
              ClaudeStream.tokensOf(
                model.number('inputTokens'),
                model.number('cacheCreationInputTokens'),
                model.number('outputTokens'),
              ),
            0,
          )
        : ClaudeStream.tokensOf(
            usage.number('input_tokens'),
            usage.number('cache_creation_input_tokens'),
            usage.number('output_tokens'),
          );
    this.owe(Math.max(0, total - this.counted));
  }

  private owe(tokens: number): void {
    this.counted += tokens;
    this.owed += tokens;
  }

  private takeOwed(): number {
    const tokens = this.owed;
    this.owed = 0;
    return tokens;
  }

  private static tokensOf(input: number, cacheCreation: number, output: number): number {
    return Math.max(0, Math.trunc(input + cacheCreation + output));
  }

  private static shortName(name: string): string {
    return name.startsWith(ClaudeStream.SERVER_PREFIX)
      ? name.slice(ClaudeStream.SERVER_PREFIX.length)
      : name;
  }

  /** 모르는 도구는 쓰기로 본다: 무언가 바꿨을 수 있다 */
  private static kindOf(name: string): string {
    return ClaudeStream.READ_TOOLS.has(ClaudeStream.shortName(name))
      ? RunEvent.READ
      : RunEvent.WRITE;
  }

  private static describe(name: string, input: Json): string {
    const target = ClaudeStream.TARGETS.map((key) => input.text(key)).find((value) => value);
    return target ? `${ClaudeStream.shortName(name)} ${target}` : ClaudeStream.shortName(name);
  }

  /** tool_result의 content는 글이거나 블록 목록이다 */
  private static resultBody(block: Json): string {
    return (
      block.text('content') ||
      block
        .list('content')
        .map((part) => part.text('text'))
        .join('\n')
    );
  }
}
