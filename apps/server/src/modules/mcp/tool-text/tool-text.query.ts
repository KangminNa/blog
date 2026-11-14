import { Injectable } from '@nestjs/common';
import {
  type Actor,
  BaseQuery,
  type BaseTool,
  Database,
  NotFound,
  type ToolTextBody,
  ToolTexts,
} from '../../platform';
import type { ToolTextRevisionRow, ToolTextRow } from '../mcp.tables';
import { McpToolbox } from '../mcp-toolbox';
import {
  ToolTextDetailView,
  ToolTextListView,
  ToolTextRevisionView,
  ToolTextSummaryView,
} from './tool-text.view';

/** 도구 설명 줄과 지금 쓰는 콘솔 판의 글 */
interface ToolTextWithActive extends ToolTextRow {
  active_description: string | null;
  active_input: Record<string, string> | null;
  active_based_on: string | null;
}

// 도구 설명 읽기. 콘솔 "도구 설명" 메뉴는 주인만, MCP 도구 목록(describe)은 붙은 기기 · 작업 누구든 (자기 공간의 판).
// 목록은 지금 열린 도구마다 한 줄이고, 콘솔 판이 있으면 기본 글 위에 얹은 글을 보인다.
@Injectable()
export class ToolTextQuery extends BaseQuery {
  constructor(
    db: Database,
    private readonly toolbox: McpToolbox,
  ) {
    super(db);
  }

  /** MCP tools/list: 도구마다 AI에게 보일 설명과 칸 설명을 얹은 입력 모양 (기본 글 + 공간의 콘솔 판) */
  async describe(
    actor: Actor,
    tools: readonly BaseTool[],
  ): Promise<{ description: string; inputSchema: Record<string, unknown> }[]> {
    const rows = actor.spaceId === null ? new Map() : await this.rowsOf(actor.spaceId);
    return tools.map((tool) => ToolTexts.apply(tool, this.textOf(tool, rows.get(tool.name))));
  }

  async list(actor: Actor): Promise<ToolTextListView> {
    actor.assertOwner();
    const rows = await this.rowsOf(actor.requireSpace());
    return new ToolTextListView(
      this.toolbox.toolsNow().map((tool) => this.summary(tool, rows.get(tool.name) ?? null)),
    );
  }

  async detail(actor: Actor, name: string): Promise<ToolTextDetailView> {
    actor.assertOwner();
    const tool = this.toolOf(name);
    const row = (await this.rowsOf(actor.requireSpace(), name)).get(name) ?? null;
    const revisions = row
      ? await this.sql<ToolTextRevisionRow[]>`
          SELECT * FROM mcp.tool_text_revisions WHERE tool_text_id = ${row.id} ORDER BY revision DESC`
      : [];
    const base = this.toolbox.defaultText(tool);
    return new ToolTextDetailView(
      this.summary(tool, row),
      this.textOf(tool, row).input ?? {},
      base.description,
      base.input ?? {},
      ToolTexts.hash(base),
      ToolTexts.types(tool.inputSchema),
      revisions,
    );
  }

  async revision(actor: Actor, name: string, revision: number): Promise<ToolTextRevisionView> {
    actor.assertOwner();
    if (!Number.isInteger(revision) || revision < 1)
      throw new NotFound(`없는 버전이에요: ${revision}`);
    const [row] = await this.sql<ToolTextRevisionRow[]>`
      SELECT r.* FROM mcp.tool_text_revisions r JOIN mcp.tool_texts t ON t.id = r.tool_text_id
      WHERE t.space_id = ${actor.requireSpace()} AND t.tool = ${name} AND r.revision = ${revision}`;
    if (!row) throw new NotFound(`없는 버전이에요: ${revision}`);
    return new ToolTextRevisionView(row);
  }

  private summary(tool: BaseTool, row: ToolTextWithActive | null): ToolTextSummaryView {
    const changed =
      row?.active_based_on != null &&
      row.active_based_on !== ToolTexts.hash(this.toolbox.defaultText(tool));
    return new ToolTextSummaryView(
      tool.name,
      this.toolbox.isPlugin(tool) ? 'plugin' : 'core',
      this.textOf(tool, row).description,
      row,
      changed,
    );
  }

  /** 지금 쓰는 글: 기본 글 위에 콘솔 판(쓰고 있으면) */
  private textOf(tool: BaseTool, row: ToolTextWithActive | null | undefined): ToolTextBody {
    const over =
      row?.active_description == null
        ? null
        : { description: row.active_description, input: row.active_input ?? {} };
    return ToolTexts.merge(this.toolbox.defaultText(tool), over);
  }

  private toolOf(name: string): BaseTool {
    const tool = this.toolbox.toolsNow().find((t) => t.name === name);
    if (!tool) throw new NotFound(`지금 열린 도구가 아니에요: ${name}`);
    return tool;
  }

  private async rowsOf(
    spaceId: string,
    tool?: string,
  ): Promise<ReadonlyMap<string, ToolTextWithActive>> {
    const rows = await this.sql<ToolTextWithActive[]>`
      SELECT t.*, r.description AS active_description, r.input AS active_input, r.based_on AS active_based_on
      FROM mcp.tool_texts t
      LEFT JOIN mcp.tool_text_revisions r ON r.tool_text_id = t.id AND r.revision = t.active_revision
      WHERE t.space_id = ${spaceId} ${tool === undefined ? this.sql`` : this.sql`AND t.tool = ${tool}`}`;
    return new Map(rows.map((r) => [r.tool, r]));
  }
}
