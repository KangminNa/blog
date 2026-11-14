import {
  Actor,
  Command,
  Conflict,
  NotFound,
  Operation,
  Read,
  type RequestFields,
  Rule,
  RuleViolation,
  type Work,
} from '../../../apps/server/src/plugin-api';
import {
  ClickDetailView,
  ClickListView,
  ClickSavedView,
  ClickView,
  HeldView,
  NextClickView,
} from './click-views';
import { clickDone, pageUrlOf, siteOfJob } from './job';
import { clicks, shots, sites } from './schema';
import { addShot, decodeImage, imageOf, shotsOf } from './shots';
import type { ClickRow } from './tables';

// 결재된 클릭 (2차 3단계, 2026-11-14). AI는 마지막 버튼(제출 · 결제 · 게시) 앞에서 멈추고, 러너(AI 없음)가
// 그 버튼을 역할 + 이름으로 다시 찾아 지문 · 화면과 함께 붙잡는다(browser_click_hold) → 러너가 결재를 올린다.
// 승인되면 클릭이 approved가 되고, 붙잡은 러너의 클릭 고리가 가져가(browser_click_next) 같은 탭 · 주소 · 지문인지
// 다시 본 뒤에만 누르고 결과를 남긴다(browser_click_save). 다르면 누르지 않는다 (changed → 작업 실패 → 콘솔 화면에서 직접).
//   held → approved → clicking → clicked · changed · unknown,  held → dropped,  approved · changed · unknown → manual

/** 누르는 중(clicking)이 이보다 오래면 러너가 사라진 것으로 본다. 다시 누르지 않는다 (많아야 한 번) */
const CLICKING_MS = 2 * 60 * 1000;
const ROLES = /^[a-z]{1,40}$/;
const TAB_ID = /^[A-Za-z0-9]{1,64}$/;
const SPAN = 100_000;

/** 화면이 본 판 */
const versionOf = (f: RequestFields) => f.integer('version', 1, 2_147_483_647);

type HoldInput = {
  taskId: string;
  tabId: string;
  pageUrl: string;
  pageTitle: string;
  role: string;
  name: string;
  nth: number;
  box: { x: number; y: number; width: number; height: number };
  fingerprint: string;
  note: string | null;
  image: string;
};

/** MCP browser_click_hold: 러너가 다시 찾은 마지막 버튼을 붙잡는다. 페이지는 사이트의 허용 출처 안이어야 한다 */
export class HoldClick extends Command<HoldInput> {
  readonly name = 'holdClick';
  readonly allow = Actor.RUN;

  input(raw: unknown): HoldInput {
    return this.fields(raw, (f) => {
      const box = f.nested('box');
      const role = f.text('role', 40);
      const tabId = f.text('tab_id', 64);
      const fingerprint = f.text('fingerprint', 64);
      if (role && !ROLES.test(role)) f.reject('role', '역할은 소문자 영어예요 (button · link …)');
      if (tabId && !TAB_ID.test(tabId)) f.reject('tab_id', '맞지 않는 탭 id예요');
      if (fingerprint && !/^[0-9a-f]{64}$/.test(fingerprint))
        f.reject('fingerprint', 'sha256(16진수 64자)이어야 해요');
      return {
        taskId: f.uuid('task_id'),
        tabId,
        pageUrl: pageUrlOf(f, 'page_url'),
        pageTitle: f.optionalText('page_title', 300) ?? '',
        role,
        name: f.text('name', 200),
        nth: f.integer('nth', 0, 50),
        box: {
          x: box.integer('x', -SPAN, SPAN),
          y: box.integer('y', -SPAN, SPAN),
          width: box.integer('width', 0, SPAN),
          height: box.integer('height', 0, SPAN),
        },
        fingerprint,
        note: f.optionalText('note', 500),
        image: imageOf(f, 'image', true) ?? '',
      };
    });
  }

  async run(work: Work, actor: Actor, input: HoldInput): Promise<HeldView> {
    const site = await siteOfJob(work, actor, input.taskId);
    const space = actor.requireSpace();
    if (!site.origins.includes(new URL(input.pageUrl).origin))
      throw new RuleViolation('허용 출처 밖의 페이지라 붙잡지 않아요');
    const image = decodeImage(input.image);
    // 결재를 올리지 못하고 끝난 앞 실행의 클릭이 남아 있으면 닫는다 (작업 하나에 열린 클릭은 하나)
    for (const old of await work.rows(clicks, { task_id: input.taskId, status: 'held' }))
      await close(work, old, 'dropped', '다시 붙잡았어요');
    await work.insertRows(clicks, {
      space_id: space,
      task_id: input.taskId,
      site_id: site.id,
      runner_id: actor.id ?? '',
      tab_id: input.tabId,
      page_url: input.pageUrl,
      page_title: input.pageTitle,
      role: input.role,
      name: input.name,
      nth: input.nth,
      box: input.box,
      fingerprint: input.fingerprint,
      note: input.note,
    });
    const held = (await work.row(clicks, { task_id: input.taskId, status: 'held' })) as ClickRow;
    await addShot(
      work,
      space,
      input.taskId,
      'before',
      image,
      {
        url: input.pageUrl,
        title: input.pageTitle,
      },
      held.id,
    );
    return new HeldView(held);
  }
}

/** 클릭의 상태를 바꾼다 (판을 올린다). 본 판이 아니면 0 */
async function close(
  work: Work,
  row: ClickRow,
  status: string,
  reason: string | null,
  extra: { after_url?: string | null } = {},
): Promise<number> {
  return work.updateRows(
    clicks,
    { status, reason, ...extra, version: row.version + 1 },
    { id: row.id, version: row.version },
  );
}

/**
 * MCP browser_click_next: 이 러너가 누를 승인된 클릭 하나를 clicking으로 가져온다 (러너의 클릭 고리).
 * 2분이 넘도록 clicking인 것은 러너가 누르다 사라진 것이라 unknown으로 닫는다 (다시 누르지 않는다)
 */
export class NextClick extends Command<null> {
  readonly name = 'nextClick';
  readonly allow = Actor.RUN;

  input(): null {
    return null;
  }

  async run(work: Work, actor: Actor): Promise<NextClickView> {
    const space = actor.requireSpace();
    const runner = actor.id ?? '';
    const lost = await work.rows(clicks, {
      space_id: space,
      runner_id: runner,
      status: 'clicking',
      clicked_at: Rule.before(new Date(Date.now() - CLICKING_MS)),
    });
    for (const row of lost) {
      const why = '누르는 중에 러너가 멈췄어요. 눌렸는지 콘솔 화면에서 확인해 주세요';
      if ((await close(work, row, 'unknown', why)) && row.approval_id)
        clickDone(work, space, row.approval_id, why);
    }
    const next = await work.row(
      clicks,
      { space_id: space, runner_id: runner, status: 'approved' },
      { order: ['id'] },
    );
    if (!next) return new NextClickView(null);
    const took = await work.updateRows(
      clicks,
      { status: 'clicking', clicked_at: Rule.now, version: next.version + 1 },
      { id: next.id, version: next.version, status: 'approved' },
    );
    return new NextClickView(
      took ? { ...next, status: 'clicking', version: next.version + 1 } : null,
    );
  }
}

type SaveInput = {
  id: string;
  version: number;
  outcome: string;
  reason: string | null;
  afterUrl: string | null;
  image: string | null;
};

/** MCP browser_click_save: 누른 결과(clicked) 또는 누르지 않은 까닭(changed)과 그때의 화면. 가져간 러너만 */
export class SaveClick extends Command<SaveInput> {
  readonly name = 'saveClick';
  readonly allow = Actor.RUN;

  input(raw: unknown): SaveInput {
    return this.fields(raw, (f) => {
      const outcome = f.text('outcome', 10);
      if (outcome && !['clicked', 'changed'].includes(outcome))
        f.reject('outcome', 'clicked · changed 중 하나예요');
      const after = f.optionalText('after_url', 2000);
      return {
        id: f.uuid('id'),
        version: versionOf(f),
        outcome,
        reason: f.optionalText('reason', 500),
        afterUrl: after && /^https?:\/\//i.test(after) ? after : null,
        image: imageOf(f, 'image', false),
      };
    });
  }

  async run(work: Work, actor: Actor, input: SaveInput): Promise<ClickSavedView> {
    const space = actor.requireSpace();
    const row = await work.row(clicks, {
      id: input.id,
      space_id: space,
      runner_id: actor.id ?? '',
    });
    if (!row) throw new NotFound('없는 클릭이에요');
    if (row.status !== 'clicking' || row.version !== input.version)
      throw new Conflict(`누르는 중인 클릭이 아니에요 (${row.status})`);
    const changed = input.outcome === 'changed';
    const reason = input.reason ?? (changed ? '페이지가 바뀌었어요' : null);
    await close(work, row, input.outcome, reason, { after_url: input.afterUrl });
    if (input.image)
      await addShot(
        work,
        space,
        row.task_id,
        changed ? 'changed' : 'after',
        decodeImage(input.image),
        {
          url: input.afterUrl ?? row.page_url,
          title: '',
        },
        row.id,
      );
    if (row.approval_id)
      clickDone(
        work,
        space,
        row.approval_id,
        changed
          ? `페이지가 바뀌어 누르지 않았어요 (${reason}). 콘솔 화면에서 직접 눌러 주세요`
          : null,
      );
    const saved = (await work.row(clicks, { id: row.id })) as ClickRow;
    return new ClickSavedView(saved);
  }
}

/**
 * POST /api/p/browser-tabs/clicks/:id/manual { version, done }: 관리자가 콘솔 화면에서 직접 눌렀다(done) · 그만둔다 (관리자).
 * 승인돼 기다리던 클릭이면 그 결과로 작업을 끝낸다. 이미 끝난 클릭(바뀜 · 모름)은 기록만 남긴다 (작업은 이미 실패로 끝났다)
 */
export class ManualClick extends Command<{ id: string; version: number; done: boolean }> {
  readonly name = 'manualClick';
  readonly allow = Operation.OWNER;

  input(raw: unknown): { id: string; version: number; done: boolean } {
    return this.fields(raw, (f) => ({
      id: f.uuid('id'),
      version: versionOf(f),
      done: f.boolean('done'),
    }));
  }

  async run(
    work: Work,
    actor: Actor,
    input: { id: string; version: number; done: boolean },
  ): Promise<ClickView> {
    const space = actor.requireSpace();
    const row = await work.row(clicks, { id: input.id, space_id: space });
    if (!row) throw new NotFound('없는 클릭이에요');
    if (!['approved', 'changed', 'unknown'].includes(row.status))
      throw new Conflict(`지금은 기록할 수 없는 클릭이에요 (${row.status})`);
    const why = input.done ? '콘솔 화면에서 직접 눌렀어요' : '그만뒀어요';
    if ((await close(work, { ...row, version: input.version }, 'manual', why)) === 0)
      throw new Conflict('다른 곳에서 먼저 바뀌었어요. 새로 불러와 주세요');
    if (row.status === 'approved' && row.approval_id)
      clickDone(work, space, row.approval_id, input.done ? null : why);
    return new ClickView((await work.row(clicks, { id: row.id })) as ClickRow, null);
  }
}

/** GET /api/p/browser-tabs/clicks?status=: 최근 클릭 (관리자) */
export class ListClicks extends Read<{ status: string | null }> {
  static readonly LIMIT = 50;
  readonly name = 'listClicks';
  readonly allow = Operation.OWNER;

  input(raw: unknown): { status: string | null } {
    return this.fields(raw, (f) => ({ status: f.optionalText('status', 20) }));
  }

  async run(work: Work, actor: Actor, input: { status: string | null }): Promise<ClickListView> {
    const space = actor.requireSpace();
    const rows = await work.rows(
      clicks,
      { space_id: space, status: Rule.maybe(input.status) },
      { order: ['id desc'], limit: ListClicks.LIMIT },
    );
    const names = new Map(
      (await work.rows(sites, { space_id: space })).map((s) => [s.id, s.name] as const),
    );
    return new ClickListView(rows.map((r) => new ClickView(r, names.get(r.site_id) ?? null)));
  }
}

/** GET /api/p/browser-tabs/clicks/:id: 클릭 하나와 멈춘 화면 · 누른 뒤 화면, 그 작업의 화면 목록 (관리자. 결재 화면이 그린다) */
export class ClickDetail extends Read<{ id: string }> {
  readonly name = 'click';
  readonly allow = Operation.OWNER;

  input(raw: unknown): { id: string } {
    return this.fields(raw, (f) => ({ id: f.uuid('id') }));
  }

  async run(work: Work, actor: Actor, input: { id: string }): Promise<ClickDetailView> {
    const space = actor.requireSpace();
    const row = await work.row(clicks, { id: input.id, space_id: space });
    if (!row) throw new NotFound('없는 클릭이에요');
    const site = await work.row(sites, { id: row.site_id, space_id: space });
    const before = await work.row(shots, { click_id: row.id, kind: 'before' });
    const after = await work.row(shots, { click_id: row.id, kind: ['after', 'changed'] });
    return new ClickDetailView(
      new ClickView(row, site?.name ?? null),
      before,
      after,
      await shotsOf(work, space, row.task_id),
    );
  }
}
