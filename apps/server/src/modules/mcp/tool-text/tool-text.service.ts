import { Injectable } from '@nestjs/common';
import {
  type Actor,
  type BaseTool,
  Conflict,
  Database,
  EntityService,
  Idempotency,
  NotFound,
  type Sql,
  ToolTexts,
} from '../../platform';
import { McpToolbox } from '../mcp-toolbox';
import { ToolText } from './tool-text';
import type { ActivateToolTextInput, SaveToolTextInput } from './tool-text.input';
import { ToolTextRepository } from './tool-text.repository';

// 도구 설명 쓰기: 콘솔 판 쌓기, 쓸 판 옮기기(기본으로 되돌리기). 주인만 (write 기기도 안 된다: AI에게 주는 글이다).
// 고칠 수 있는 것은 지금 열린 도구뿐이다 (코어 도구와 동작 중인 기능 패키지의 도구).
@Injectable()
export class ToolTextService extends EntityService<ToolText> {
  private static readonly SAVE = 'save_tool_text';

  constructor(
    db: Database,
    private readonly toolbox: McpToolbox,
  ) {
    super(db);
  }

  protected store(tx: Sql): ToolTextRepository {
    return new ToolTextRepository(tx);
  }

  /** 새 판을 쌓고 바로 그 판을 쓴다. 같은 requestId가 다시 오면 처음 결과. 본 version이 다르면 409 */
  async saveRevision(actor: Actor, req: SaveToolTextInput): Promise<ToolText> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    const tool = this.toolOf(req.tool);
    const paths = ToolTexts.paths(tool.inputSchema);
    const baseHash = ToolTexts.hash(this.toolbox.defaultText(tool));
    const now = new Date();
    return this.transaction(async (tx) => {
      const texts = new ToolTextRepository(tx);
      const once = new Idempotency(tx, actor.id ?? spaceId, req.requestId, ToolTextService.SAVE);
      const before = await once.previous();
      if (before) return texts.load(spaceId, String(before.toolTextId));
      const found = await texts.lockByTool(spaceId, req.tool);
      // 콘솔 판이 아직 없으면 화면이 본 version은 0이다
      if (!found && req.version !== 0)
        throw new Conflict('다른 곳에서 먼저 바뀌었어요. 새로 불러온 뒤 다시 해 주세요');
      found?.assertVersion(req.version);
      const text = found ?? ToolText.open(spaceId, req.tool, now);
      const body = { description: req.description, input: req.input };
      text.addRevision(body, paths, baseHash, req.note, now);
      await texts.save(text);
      await once.remember({ toolTextId: text.id });
      return text;
    });
  }

  /** 쓸 판을 옮긴다 (되돌리기). null이면 기본 글. 콘솔 판이 하나도 없으면 404 */
  async activate(actor: Actor, req: ActivateToolTextInput): Promise<ToolText> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    this.toolOf(req.tool);
    return this.transaction(async (tx) => {
      const texts = new ToolTextRepository(tx);
      const text = await texts.lockByTool(spaceId, req.tool);
      if (!text) throw new NotFound(`콘솔 버전이 없는 도구예요: ${req.tool}`);
      text.assertVersion(req.version);
      text.activate(req.revision, new Date());
      await texts.save(text);
      return text;
    });
  }

  private toolOf(name: string): BaseTool {
    const tool = this.toolbox.toolsNow().find((t) => t.name === name);
    if (!tool) throw new NotFound(`지금 열린 도구가 아니에요: ${name}`);
    return tool;
  }
}
