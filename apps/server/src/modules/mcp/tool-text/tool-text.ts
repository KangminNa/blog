import {
  BaseEntity,
  NotFound,
  RuleViolation,
  TableEntity,
  type ToolTextBody,
} from '../../platform';
import type { ToolTextNew, ToolTextRevisionNew, ToolTextRow } from '../mcp.tables';
import { ToolTextSavedView } from './tool-text.view';

// MCP 도구 하나의 글을 콘솔에서 고친 판들 (mcp.tool_texts + mcp.tool_text_revisions, 2차 1-0 · 기획서 결정 2026-11-14).
// 기본 글(코어는 <모듈>.tools.ko.json, 기능 패키지는 목록 파일) 위에 주인이 고친 판을 얹는다. 판은 추가만 하고(트리거),
// 지금 쓰는 판(active_revision)만 바뀐다. 비어 있으면 기본 글이다 (기본으로 되돌리기도 지금 쓰는 판을 옮기는 것).
// 글은 AI에게 주는 안내일 뿐이라 권한 · 결재 · 입력 모양(형식 · 길이)을 바꾸지 못한다. 고치는 것은 주인만 (ToolTextService).
export class ToolText extends TableEntity<ToolTextRow, ToolTextNew> {
  static readonly DESCRIPTION_MAX = 4000;
  static readonly FIELD_MAX = 1000;
  static readonly NOTE_MAX = 500;
  /** 이번에 쌓을 판 (saveParts가 넣는다) */
  private added: ToolTextRevisionNew | null = null;

  /** 처음 고칠 때 만든다. 판이 하나도 없으면 기본 글을 쓴다 */
  static open(spaceId: string, tool: string, now: Date): ToolText {
    return new ToolText(
      {
        id: BaseEntity.newId(),
        space_id: spaceId,
        tool,
        active_revision: null,
        revisions: 0,
        created_at: now,
        updated_at: now,
      },
      true,
    );
  }

  static restore(row: ToolTextRow): ToolText {
    return new ToolText(row);
  }

  /**
   * 주인이 고친 새 판을 쌓고 바로 그 판을 쓴다. paths는 지금 도구의 칸 경로, base는 그때의 기본 글 (해시를 남긴다).
   * 설명은 1~4000자, 칸 설명은 그 도구에 있는 칸만 1000자까지. 비운 칸은 기본 글을 쓴다
   */
  addRevision(
    text: ToolTextBody,
    paths: readonly string[],
    baseHash: string,
    note: string,
    now: Date,
  ): void {
    const description = text.description.trim();
    if (!description) throw new RuleViolation('도구 설명이 비었어요');
    if (description.length > ToolText.DESCRIPTION_MAX)
      throw new RuleViolation(`도구 설명은 ${ToolText.DESCRIPTION_MAX}자까지예요`);
    const input: Record<string, string> = {};
    for (const [path, raw] of Object.entries(text.input ?? {})) {
      if (!paths.includes(path)) throw new RuleViolation(`이 도구에 없는 칸이에요: ${path}`);
      const said = raw.trim();
      if (said.length > ToolText.FIELD_MAX)
        throw new RuleViolation(`칸 설명은 ${ToolText.FIELD_MAX}자까지예요: ${path}`);
      if (said) input[path] = said;
    }
    const memo = note.trim();
    if (memo.length > ToolText.NOTE_MAX)
      throw new RuleViolation(`메모는 ${ToolText.NOTE_MAX}자까지예요`);
    const revision = this.row.revisions + 1;
    this.put('revisions', revision);
    this.put('active_revision', revision);
    this.put('updated_at', now);
    this.added = {
      id: BaseEntity.newId(),
      tool_text_id: this.id,
      revision,
      description,
      input,
      based_on: baseHash,
      note: memo,
      created_at: now,
    };
  }

  /** 쓸 판을 옮긴다. null이면 기본 글. 이미 그 판이면 아무것도 바뀌지 않는다 */
  activate(revision: number | null, now: Date): void {
    if (revision !== null && (revision < 1 || revision > this.row.revisions))
      throw new NotFound(`없는 버전이에요: ${revision}`);
    if (revision === this.row.active_revision) return;
    this.put('active_revision', revision);
    this.put('updated_at', now);
  }

  /** 저장할 새 판 (Repository가 부른다) */
  get addedRevision(): ToolTextRevisionNew | null {
    return this.added;
  }

  view(): ToolTextSavedView {
    return new ToolTextSavedView(this.row);
  }
}
