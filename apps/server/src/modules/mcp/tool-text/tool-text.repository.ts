import { TableRepository } from '../../platform';
import { toolTextRevisions, toolTexts } from '../mcp.schema';
import type { ToolTextRow } from '../mcp.tables';
import { ToolText } from './tool-text';

// mcp.tool_texts ↔ ToolText. 판(mcp.tool_text_revisions)은 saveParts로 함께 넣는다 (추가만).
export class ToolTextRepository extends TableRepository<ToolTextRow, ToolText> {
  protected readonly table = toolTexts;
  protected readonly noun = '도구 설명';

  protected toEntity(row: ToolTextRow): ToolText {
    return ToolText.restore(row);
  }

  /**
   * 도구 이름으로 잠근다. 콘솔 판이 아직 없으면 null.
   * 줄이 없을 수도 있어 먼저 공간 · 도구로 advisory 잠금을 건다: 동시에 처음 고치는 둘이 줄을 하나씩 만들지 않게
   */
  async lockByTool(spaceId: string, tool: string): Promise<ToolText | null> {
    await this
      .sql`SELECT pg_advisory_xact_lock(hashtextextended(${`mcp.tool_text:${spaceId}:${tool}`}, 0))`;
    return this.findOne({ space_id: spaceId, tool }, { lock: true });
  }

  protected override async saveParts(text: ToolText): Promise<void> {
    const revision = text.addedRevision;
    if (revision) await this.insertRows(toolTextRevisions, revision);
  }
}
