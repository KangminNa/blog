import { Actor } from '../base/actor';
import { BaseTool, type ToolAnswer } from '../base/base-tool';
import { Operation } from '../base/operation';
import type { PackageService } from './package.service';
import type { PackageOperation } from './plugin-context';
import type { PackageToolSpec } from './plugin-manifest';

// 기능 패키지의 동작 하나를 MCP 도구로 연다. 이름 · 설명 · 입력 모양은 목록 파일 tools에서,
// 권한은 동작의 allow에서 온다 (주인만인 동작은 기기 · 에이전트에게 보이지 않는다).
export class PackageTool extends BaseTool {
  /** 기기 · 에이전트에게는 주지 않는 권한 이름 (주인만인 동작) */
  private static readonly NOBODY = 'owner-only';

  readonly scope: string;
  readonly readOnly: boolean;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;

  constructor(
    readonly name: string,
    spec: PackageToolSpec,
    private readonly found: PackageOperation,
    private readonly packages: PackageService,
  ) {
    super();
    const allow = found.operation.allow;
    this.scope =
      allow === Operation.ANYONE
        ? Actor.READ_PUBLIC
        : allow === Operation.OWNER
          ? PackageTool.NOBODY
          : allow;
    this.readOnly = !found.operation.writes;
    this.description = spec.description;
    this.inputSchema = spec.input;
  }

  handle(actor: Actor, raw: unknown): Promise<ToolAnswer> {
    return this.packages.run(actor, this.found, raw);
  }
}
