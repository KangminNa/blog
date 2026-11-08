import type { AiStream } from './ai-tool';
import { Json } from './json';
import { type PlanWindow, RunEvent } from './progress';

// codex exec --json의 줄을 실행 기록으로 바꾼다. 한 줄 = 사건 하나 (Codex 0.164.0으로 확인한 모양).
//   item.started  mcp_tool_call     →  read · write. 허락하지 않은 서버면 격리가 깨진 것
//                 command_execution →  셸은 꺼 두었으니 보이면 격리가 깨진 것
//   item.completed agent_message    →  마지막 답으로 기억한다
//                  mcp_tool_call    →  실패했으면 error
//                  file_change      →  write (작업 폴더 안)
//                  error            →  error (경고)
//   turn.completed                   →  마지막 답과 토큰
//   turn.failed · error              →  실패 이유
//
// 토큰: Codex는 턴이 끝날 때 한 번 알린다. input에 캐시 읽기가 들어 있어 빼고 output을 더한다 (Claude와 같은 셈).
// 도중에 끈 실행(취소 등)은 토큰을 알 수 없다. 구독 사용률은 exec가 알려 주지 않아 아직 읽지 않는다.
export class CodexStream implements AiStream {
  /** 늘 허락하는 MCP 서버. 브라우저 작업에서만 playwright를 더한다 (BrowserMcp) */
  static readonly SERVER = 'cairn';
  private static readonly READ_TOOLS: ReadonlySet<string> = new Set([
    'search_sessions',
    'get_session',
    'search_wikis',
    'get_wiki',
    'neighbors',
    'blog_get_post',
    'basket_get',
    'browser_snapshot',
    'browser_navigate',
    'browser_take_screenshot',
    'browser_tabs',
  ]);
  /** 도구 입력에서 대상으로 보여 줄 칸. 내용은 남기지 않는다 */
  private static readonly TARGETS = [
    'query',
    'post_id',
    'session_id',
    'wiki_id',
    'node_id',
    'title',
    'url',
  ];

  private lastText = '';
  private resultText: string | null = null;
  private failureText: string | null = null;
  private lastError: string | null = null;
  private breachText: string | null = null;

  constructor(
    /** 이 실행에서 허락한 MCP 서버. 그 밖의 서버의 도구를 부르면 격리가 깨진 것 */
    private readonly servers: readonly string[] = [CodexStream.SERVER],
  ) {}

  get finalText(): string {
    return this.resultText ?? this.lastText;
  }

  /** 턴이 실패했거나, 결과 없이 오류가 났다면 그 이유 */
  get failure(): string | null {
    return this.failureText ?? (this.resultText === null ? this.lastError : null);
  }

  get breach(): string | null {
    return this.breachText;
  }

  takePlanUsage(): readonly PlanWindow[] {
    return [];
  }

  read(line: string): readonly RunEvent[] {
    const event = Json.parse(line);
    if (event === null) return [];
    switch (event.text('type')) {
      case 'item.started':
        return this.started(event.child('item'));
      case 'item.completed':
        return this.completed(event.child('item'));
      case 'turn.completed':
        return this.turnCompleted(event.child('usage'));
      case 'turn.failed':
        return this.fail(event.child('error').text('message'));
      case 'error':
        this.lastError = event.text('message') || this.lastError;
        return this.lastError ? [new RunEvent(RunEvent.ERROR, this.lastError, 0)] : [];
      default:
        return [];
    }
  }

  finish(): readonly RunEvent[] {
    return [];
  }

  private started(item: Json): readonly RunEvent[] {
    switch (item.text('type')) {
      case 'mcp_tool_call':
        return this.toolCall(item);
      case 'command_execution':
        return this.shellOpened(item);
      default:
        return [];
    }
  }

  private completed(item: Json): readonly RunEvent[] {
    switch (item.text('type')) {
      case 'agent_message':
        this.lastText = item.text('text') || this.lastText;
        return [];
      case 'mcp_tool_call':
        return CodexStream.toolFailed(item);
      case 'command_execution':
        return this.shellOpened(item);
      case 'file_change': {
        const paths = item
          .list('changes')
          .map((change) => change.text('path'))
          .filter(Boolean);
        return [new RunEvent(RunEvent.WRITE, `파일 ${paths.join(', ')}`.trim(), 0)];
      }
      case 'error':
        return [new RunEvent(RunEvent.ERROR, item.text('message'), 0)];
      default:
        return [];
    }
  }

  private toolCall(item: Json): readonly RunEvent[] {
    const server = item.text('server');
    if (!this.servers.includes(server)) {
      this.breachText ??= `허락하지 않은 MCP 서버: ${server || '(이름 없음)'}`;
      return [];
    }
    const tool = item.text('tool');
    const kind = CodexStream.READ_TOOLS.has(tool) ? RunEvent.READ : RunEvent.WRITE;
    return [new RunEvent(kind, CodexStream.describe(tool, item.child('arguments')), 0)];
  }

  private static toolFailed(item: Json): readonly RunEvent[] {
    const failed = item.text('status') === 'failed' || item.child('error').text('message') !== '';
    if (!failed) return [];
    const why = item.child('error').text('message') || '도구가 실패했어요';
    return [new RunEvent(RunEvent.ERROR, `${item.text('tool')}: ${why}`, 0)];
  }

  /** 셸은 꺼 두었다 (CodexCli). 셸 명령이 보이면 설정이 먹지 않은 것이라 끈다 */
  private shellOpened(item: Json): readonly RunEvent[] {
    this.breachText ??= `셸이 열려 있어요: ${item.text('command') || '(명령)'}`;
    return [];
  }

  private turnCompleted(usage: Json): readonly RunEvent[] {
    const input = usage.number('input_tokens');
    const cached = Math.min(usage.number('cached_input_tokens'), input);
    const tokens = Math.max(0, Math.trunc(input - cached + usage.number('output_tokens')));
    this.resultText = this.lastText;
    return [new RunEvent(RunEvent.RESULT, this.resultText, tokens)];
  }

  private fail(message: string): readonly RunEvent[] {
    this.failureText = message || 'Codex가 실패로 끝났어요';
    return [new RunEvent(RunEvent.ERROR, this.failureText, 0)];
  }

  private static describe(tool: string, args: Json): string {
    const target = CodexStream.TARGETS.map((key) => args.text(key)).find((value) => value);
    return target ? `${tool} ${target}` : tool;
  }
}
