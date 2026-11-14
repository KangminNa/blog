import {
  type Actor,
  DomainEvent,
  type LeasedWork,
  NotFound,
  type RequestFields,
  RuleViolation,
  type Work,
} from '../../../apps/server/src/plugin-api';
import { clicks, sites } from './schema';
import type { ClickRow, SiteRow } from './tables';

// 브라우저 작업(browse) 하나가 어디서 도는지: 작업의 대상이 사이트(browser_site)면 그 사이트, 클릭(browser_click, 클릭 결재에서
// 고쳐 달라로 다시 온 일)이면 그 클릭의 사이트, 대상이 없으면 둘러보기. 코어의 표는 읽지 않고 임대 확인(work.leased)이 주는 대상만 본다.

/** 코어의 일 종류 */
export const BROWSE_KIND = 'browse';
/** 결재된 클릭의 결재 동작 (이름은 1차 그대로: 에이전트의 결재 동작을 옮기지 않게) */
export const PUBLISH_ACTION = 'browser.site.publish';
/** 로그인 필요의 결재 동작. "로그인했어요"는 이 결재의 수정 요청이다 */
export const LOGIN_ACTION = 'browser.site.login';
export const SITE_TARGET = 'browser_site';
export const CLICK_TARGET = 'browser_click';
/** 결재 뒤 실행의 결과 (코어의 결과 처리가 approvalId · outcome을 보고 작업을 끝낸다) */
const CLICK_DONE = 'plugin.browser_tabs.click_done';
/** 열린 클릭 (작업 하나에 하나뿐, DB의 부분 유일 인덱스) */
export const OPEN_CLICK = ['held', 'approved', 'clicking'];

/** 작업이 도는 자리: 사이트 일이면 사이트(와 앞에서 붙잡은 클릭), 둘러보기면 둘 다 null */
export type BrowsePlace = { site: SiteRow | null; held: ClickRow | null };

/** 러너가 지금 임대를 쥔 browse 작업. 쥐지 않았으면 코어가, 다른 종류면 여기서 거절한다 */
export async function leasedBrowse(work: Work, taskId: string): Promise<LeasedWork> {
  const job = await work.leased(taskId);
  if (job.kind !== BROWSE_KIND) throw new RuleViolation('브라우저 작업이 아니에요');
  return job;
}

/** 작업의 대상으로 자리를 찾는다. 지운 사이트 · 모르는 대상은 거절 */
export async function placeOf(work: Work, actor: Actor, job: LeasedWork): Promise<BrowsePlace> {
  const space = actor.requireSpace();
  if (job.targetKind === null) return { site: null, held: null };
  let held: ClickRow | null = null;
  let siteId: string | null = null;
  if (job.targetKind === SITE_TARGET) siteId = job.targetId;
  else if (job.targetKind === CLICK_TARGET && job.targetId) {
    held = await work.row(clicks, { id: job.targetId, space_id: space });
    siteId = held?.site_id ?? null;
  } else throw new RuleViolation(`브라우저 작업의 대상이 아니에요: ${job.targetKind}`);
  const site = siteId ? await work.row(sites, { id: siteId, space_id: space }) : null;
  if (!site) throw new NotFound('없는 사이트예요');
  return { site, held };
}

/** 사이트 일이어야 하는 도구 (로그인 필요 · 클릭 붙잡기) */
export async function siteOfJob(work: Work, actor: Actor, taskId: string): Promise<SiteRow> {
  const { site } = await placeOf(work, actor, await leasedBrowse(work, taskId));
  if (!site) throw new RuleViolation('둘러보기에서는 누르거나 로그인하지 않아요');
  return site;
}

/** http(s) 주소 칸 (모양만) */
export function pageUrlOf(f: RequestFields, name: string): string {
  const url = f.text(name, 2000);
  if (url && !/^https?:\/\//i.test(url)) f.reject(name, 'http · https 주소여야 해요');
  return url;
}

/** 결재 뒤 실행의 결과를 남긴다: 실패면 이유와 함께 */
export function clickDone(
  work: Work,
  spaceId: string,
  approvalId: string,
  error: string | null,
): void {
  work.record(
    new DomainEvent(CLICK_DONE, 1, spaceId, {
      approvalId,
      outcome: error === null ? 'done' : 'failed',
      ...(error === null ? {} : { error }),
    }),
  );
}
