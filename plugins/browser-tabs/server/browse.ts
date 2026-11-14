import { Actor, Command, Read, Rule, type Work } from '../../../apps/server/src/plugin-api';
import { JobView, LoginNoticedView } from './click-views';
import { leasedBrowse, pageUrlOf, placeOf, siteOfJob } from './job';
import { sites } from './schema';
import { addShot, decodeImage, imageOf } from './shots';

// 러너가 빌린 browse 작업의 자리(사이트 · 둘러보기)와 로그인 필요. 로그인 필요의 결재(browser.site.login)는 러너가 올리고,
// 관리자가 콘솔 화면에서 로그인한 뒤 "로그인했어요"(그 결재의 수정 요청)를 누르면 표시를 비우고 같은 작업이 이어서 돈다 (approvals.ts)

/** MCP browser_job: 러너가 빌린 browse 작업이 어디서 도는지 (사이트 · 둘러보기, 로그인 필요, 앞에서 붙잡은 페이지) */
export class BrowserJob extends Read<{ taskId: string }> {
  readonly name = 'job';
  readonly allow = Actor.RUN;

  input(raw: unknown): { taskId: string } {
    return this.fields(raw, (f) => ({ taskId: f.uuid('task_id') }));
  }

  async run(work: Work, actor: Actor, input: { taskId: string }): Promise<JobView> {
    const place = await placeOf(work, actor, await leasedBrowse(work, input.taskId));
    return new JobView(place.site, place.held);
  }
}

type LoginInput = { taskId: string; pageUrl: string; title: string; image: string | null };

/** MCP browser_login_needed: 사이트 일이 로그인 화면을 만났다. 사이트에 적고 그 화면을 남긴다 (러너). 결재는 러너가 올린다 */
export class LoginNeeded extends Command<LoginInput> {
  readonly name = 'loginNeeded';
  readonly allow = Actor.RUN;

  input(raw: unknown): LoginInput {
    return this.fields(raw, (f) => ({
      taskId: f.uuid('task_id'),
      pageUrl: pageUrlOf(f, 'page_url'),
      title: f.optionalText('page_title', 300) ?? '',
      image: imageOf(f, 'image', false),
    }));
  }

  async run(work: Work, actor: Actor, input: LoginInput): Promise<LoginNoticedView> {
    const site = await siteOfJob(work, actor, input.taskId);
    const space = actor.requireSpace();
    // 판은 올리지 않는다: 러너의 표시가 관리자의 사이트 편집과 부딪히지 않게
    await work.updateRows(sites, { login_needed_at: Rule.now }, { id: site.id, space_id: space });
    if (input.image)
      await addShot(work, space, input.taskId, 'login', decodeImage(input.image), {
        url: input.pageUrl,
        title: input.title,
      });
    return new LoginNoticedView(site);
  }
}
