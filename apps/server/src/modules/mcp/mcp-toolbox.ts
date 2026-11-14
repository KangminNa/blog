import { Injectable } from '@nestjs/common';
import { BlogTools } from '../blog';
import {
  type BaseTool,
  PackageService,
  PackageTool,
  PluginRegistry,
  type ToolTextBody,
  ToolTexts,
} from '../platform';
import { TaskTools } from '../task';
import { VaultTools } from '../vault';

// AI 도구에게 여는 MCP 도구 모음. 도구는 각 모듈의 목록(`*-tools.ts`)에 더하고, 여기서는 모듈별 목록을 모으기만 한다.
// 기능 패키지의 도구(목록 파일 tools)는 요청마다 지금 동작 중인 것을 더한다 (켜고 끄면 재시작 없이 바뀐다).
@Injectable()
export class McpToolbox {
  /**
   * AI 도구가 붙을 때 받는 안내 (MCP instructions). 스킬이 없는 도구도 이것만 보고 저장할 수 있게,
   * 앞 512자 안에 순서가 다 들어가게 쓴다 (Codex는 앞부분만 읽는다). 순서를 바꾸면 skills/cairn-save도 함께 고친다.
   */
  static readonly INSTRUCTIONS = [
    'Cairn 블로그의 MCP 서버. 사용자가 이 대화(세션)를 저장해 달라고 하면:',
    '1) 이 대화에서 실제로 일어난 일만 세션 노트로 쓴다: 한 일(확인된 결과와 함께), 결정(이유·고르지 않은 대안·누가 정했나), 막힌 점(확인 못 한 것 포함), 원문 그대로의 핵심 인용. 지어내지 않고, 비밀값은 [지움: 종류]로 바꾼다.',
    '2) check_session으로 검사하고 받은 request_id·source_session_id를 쓴다.',
    '3) 노트와 올릴 곳(site)을 사용자에게 보여 주고 확인받는다.',
    '4) save_session으로 저장하고 url을 알린다.',
    '같은 대화를 다시 저장할 때는 같은 source_session_id를 쓴다. cairn-save 스킬이 있으면 그 순서와 규칙을 따른다.',
  ].join('\n');

  readonly tools: readonly BaseTool[];
  /** 코어 도구의 글: 모듈마다 설명서(<모듈>.tools.ko.json)를 합친 것 */
  readonly texts: ToolTexts;

  constructor(
    vault: VaultTools,
    blog: BlogTools,
    task: TaskTools,
    private readonly registry: PluginRegistry,
    private readonly packages: PackageService,
  ) {
    this.tools = [...vault.tools, ...blog.tools, ...task.tools];
    this.texts = ToolTexts.of(vault.texts, blog.texts, task.texts);
    // 설명서가 코드와 맞지 않으면 서버가 뜨지 않는다: 설명 없는 도구 · 칸이 AI에게 나가지 않게
    const problems = this.texts.problems(this.tools);
    if (problems.length > 0)
      throw new Error(
        `도구 설명서(<모듈>.tools.ko.json)가 코드와 맞지 않아요\n${problems.join('\n')}`,
      );
  }

  /**
   * 도구의 기본 글: 코어 도구는 설명서, 기능 패키지의 도구는 목록 파일(cairn-plugin.json)의 글.
   * 주인이 콘솔 "도구 설명"에서 쌓은 판이 그 위에 얹힌다 (ToolTextQuery.describe)
   */
  defaultText(tool: BaseTool): ToolTextBody {
    if (tool instanceof PackageTool)
      return { description: tool.description, input: ToolTexts.read(tool.inputSchema) };
    return this.texts.text(tool.name) ?? { description: '' };
  }

  /** 기능 패키지의 도구인가 (콘솔 목록에서 나눠 보인다) */
  isPlugin(tool: BaseTool): boolean {
    return tool instanceof PackageTool;
  }

  /** 코어 모듈의 도구와 지금 동작 중인 기능 패키지의 도구 */
  toolsNow(): readonly BaseTool[] {
    const fromPackages = this.registry
      .packageTools()
      .map(({ name, spec, found }) => new PackageTool(name, spec, found, this.packages));
    return [...this.tools, ...fromPackages];
  }
}
