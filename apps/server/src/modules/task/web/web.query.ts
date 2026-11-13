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

  /**
   * 주인이 쓴 지시: 위임된 일이면 맨 위 일(주인이 맡긴 일)의 제목과 지시. 하위 일의 지시는 AI가 썼다.
   * 맨 위 일이 목표 실행의 회차 작업이면 실행의 지시: 회차 작업의 지시에는 앞 회차의 보고(AI가 쓴 글)가 실린다
   */
  private async ownerText(spaceId: string, taskId: string): Promise<string> {
    const [root] = await this.sql<{ text: string }[]>`
      WITH RECURSIVE up AS (
        SELECT id, parent_id, title, instruction, payload, 0 AS step FROM task.tasks
        WHERE space_id = ${spaceId} AND id = ${taskId}
        UNION ALL
        SELECT t.id, t.parent_id, t.title, t.instruction, t.payload, up.step + 1 FROM task.tasks t
        JOIN up ON t.id = up.parent_id AND t.space_id = ${spaceId}
        WHERE up.step < 10
      )
      SELECT CASE WHEN r.id IS NULL THEN up.title || E'\n' || up.instruction
                  ELSE r.title || E'\n' || r.instruction END AS text
      FROM up
      LEFT JOIN task.goal_runs r
        ON r.space_id = ${spaceId} AND r.id::text = up.payload -> 'goalRun' ->> 'runId'
      WHERE up.parent_id IS NULL ORDER BY up.step DESC LIMIT 1`;
    return root?.text ?? '';
  }
}
