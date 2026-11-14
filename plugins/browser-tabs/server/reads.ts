import {
  Actor,
  Command,
  NotFound,
  Operation,
  Read,
  Rule,
  RuleViolation,
  type Work,
} from '../../../apps/server/src/plugin-api';
import { reads } from './schema';
import { PendingView, ReadListView, ReadView, SavedView } from './views';

// browser-tabs의 동작 가운데 탭 읽기 (AI 없음). 입구(REST · MCP)는 목록 파일이 정하고, 순서(권한 → 입력 → 일 → View)는 코어가 지킨다.
// 표는 자기 스키마(browser_tabs)뿐이고, 읽기 · 쓰기는 코어의 조건 규칙(work.rows · insertRows …)으로 쓴다.
// 사이트는 sites.ts, 결재된 클릭은 clicks.ts, 화면은 shots.ts, 결재 이벤트는 approvals.ts

const REQUESTED = 'requested';
const DONE = 'done';
const FAILED = 'failed';

/** GET /api/p/browser-tabs/reads: 최근 요청과 결과 (주인) */
export class ListReads extends Read<null> {
  static readonly LIMIT = 50;
  readonly name = 'list';
  readonly allow = Operation.OWNER;

  input(): null {
    return null;
  }

  async run(work: Work, actor: Actor): Promise<ReadListView> {
    const rows = await work.rows(
      reads,
      { space_id: actor.requireSpace() },
      { order: ['id desc'], limit: ListReads.LIMIT },
    );
    return new ReadListView(rows.map((r) => new ReadView(r)));
  }
}

/** POST /api/p/browser-tabs/reads { url }: 읽어 달라고 한다 (주인). 러너가 browser_tab_pending으로 가져간다 */
export class RequestRead extends Command<{ url: string }> {
  readonly name = 'request';
  readonly allow = Operation.OWNER;

  input(raw: unknown): { url: string } {
    return this.fields(raw, (f) => ({ url: f.text('url', 2000) }));
  }

  async run(work: Work, actor: Actor, input: { url: string }): Promise<ReadListView> {
    if (!/^https?:\/\//.test(input.url)) throw new RuleViolation('http · https 주소만 읽어요');
    const space = actor.requireSpace();
    await work.insertRows(reads, { space_id: space, url: input.url });
    const rows = await work.rows(reads, { space_id: space }, { order: ['id desc'], limit: 1 });
    return new ReadListView(rows.map((r) => new ReadView(r)));
  }
}

/** MCP browser_tab_pending: 읽어 달라는 주소들, 오래된 것부터 (러너) */
export class PendingReads extends Read<null> {
  static readonly LIMIT = 5;
  readonly name = 'pending';
  readonly allow = Actor.RUN;

  input(): null {
    return null;
  }

  async run(work: Work, actor: Actor): Promise<PendingView> {
    const rows = await work.rows(
      reads,
      { space_id: actor.requireSpace(), status: REQUESTED },
      { order: ['id'], limit: PendingReads.LIMIT },
    );
    return new PendingView(rows);
  }
}

type SaveInput = { id: string; title: string | null; body: string | null; error: string | null };

/** MCP browser_tab_save: 읽은 결과를 남긴다 (러너). 요청 하나에 한 번만 */
export class SaveRead extends Command<SaveInput> {
  readonly name = 'save';
  readonly allow = Actor.RUN;

  input(raw: unknown): SaveInput {
    return this.fields(raw, (f) => ({
      id: f.uuid('id'),
      title: f.optionalText('title', 300),
      body: f.optionalText('body', 200_000),
      error: f.optionalText('error', 500),
    }));
  }

  async run(work: Work, actor: Actor, input: SaveInput): Promise<SavedView> {
    const status = input.error ? FAILED : DONE;
    const saved = await work.updateRows(
      reads,
      { status, title: input.title, body: input.body, error: input.error, read_at: Rule.now },
      { id: input.id, space_id: actor.requireSpace(), status: REQUESTED },
    );
    if (saved === 0) throw new NotFound('기다리는 요청이 아니에요 (없거나 이미 남겼어요)');
    return new SavedView(input.id, status);
  }
}
