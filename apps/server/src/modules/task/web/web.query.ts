import { Injectable } from '@nestjs/common';
import { Actor, AgentActor, BaseQuery, Database, Forbidden } from '../../platform';
import type { ReadUrlInput } from './web.input';
import { WebPageView } from './web.view';
import { WebPageGateway } from './web-page.gateway';
import { WebReach } from './web-reach.policy';

// 주소 읽기 (MCP read_url, 작업 토큰). 목줄은 WebReach, 내부망 막기와 받기는 WebPageGateway.
// 바깥 호출을 기다리는 동안 트랜잭션을 열지 않는다 (지시를 읽는 쿼리 하나만).
@Injectable()
export class WebQuery extends BaseQuery {
  constructor(
    db: Database,
    private readonly pages: WebPageGateway,
  ) {
    super(db);
  }

  async readUrl(actor: Actor, req: ReadUrlInput): Promise<WebPageView> {
    actor.assertCan(Actor.AGENT);
    if (!(actor instanceof AgentActor) || !actor.spaceId) throw new Forbidden(Actor.AGENT);
    const reach = WebReach.of(actor, await this.ownerText(actor.spaceId, actor.taskId));
    const page = await this.pages.read(req.url, (url) => reach.assertAllowed(url));
    return new WebPageView(page.url, page.title, page.text, page.truncated, page.contentType);
  }

  /** 주인이 쓴 지시: 위임된 일이면 맨 위 일(주인이 맡긴 일)의 제목과 지시. 하위 일의 지시는 AI가 썼다 */
  private async ownerText(spaceId: string, taskId: string): Promise<string> {
    const [root] = await this.sql<{ title: string; instruction: string }[]>`
      WITH RECURSIVE up AS (
        SELECT id, parent_id, title, instruction, 0 AS step FROM task.tasks
        WHERE space_id = ${spaceId} AND id = ${taskId}
        UNION ALL
        SELECT t.id, t.parent_id, t.title, t.instruction, up.step + 1 FROM task.tasks t
        JOIN up ON t.id = up.parent_id AND t.space_id = ${spaceId}
        WHERE up.step < 10
      )
      SELECT title, instruction FROM up WHERE parent_id IS NULL ORDER BY step DESC LIMIT 1`;
    return root ? `${root.title}\n${root.instruction}` : '';
  }
}
