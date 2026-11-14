import { ApprovedClick, BrowseJob } from './browse-job';
import type { HeldButton } from './browser-page';
import { Job } from './job';
import type { Json } from './json';
import type { McpClient } from './mcp-client';
import { type ProgressBatch, ProgressState, type RunResult } from './progress';
import type { RunnerAbility } from './runner-ability';

/** ai_signin의 답: 주인이 붙여 넣은 코드(한 번만), 취소됐는가, 작업의 상태 */
export class SigninReply {
  constructor(
    readonly code: string | null,
    readonly cancelled: boolean,
    readonly status: string,
  ) {}

  static from(body: Json): SigninReply {
    return new SigninReply(body.optionalText('code'), body.flag('cancelled'), body.text('status'));
  }
}

// 러너가 쓰는 MCP 도구 (코어 + 기능 패키지 code-github · browser-tabs). 모양의 원본은 docs/API설계.md 4장이다.
export class CairnServer {
  constructor(private readonly mcp: McpClient) {}

  /** 일을 limit개까지 빌린다. 없으면 waitSeconds까지 기다린다. 서버는 이 러너가 할 수 있는 일만 준다 */
  async nextJobs(
    waitSeconds: number,
    limit: number,
    stop: AbortSignal,
    ability: RunnerAbility,
  ): Promise<readonly Job[]> {
    const args = { wait_seconds: waitSeconds, limit, ...ability.toArgs() };
    const body = await this.mcp.call('next_jobs', args, waitSeconds * 1000, stop);
    return body.list('jobs').map((job) => Job.from(job));
  }

  /** 콘솔의 AI 로그인과 그 판. 없거나 만료됐으면 서버가 거절한다 (ToolRefused) */
  async aiLogin(
    tool: string,
    stop?: AbortSignal,
  ): Promise<{ token: string; version: number | null }> {
    const body = await this.mcp.call('ai_login', { tool }, 0, stop);
    return { token: body.text('token'), version: body.optionalNumber('version') };
  }

  /**
   * 실행하는 동안 CLI가 갱신한 자격을 되돌려 쓴다 (Codex의 auth.json). 저장한 뒤의 판을 돌려준다.
   * 판이 다르면 conflict (ToolRefused): 다른 실행이 먼저 바꿨다
   */
  async aiLoginRefresh(
    taskId: string,
    tool: string,
    version: number,
    credential: string,
  ): Promise<number> {
    const body = await this.mcp.call('ai_login_refresh', {
      task_id: taskId,
      tool,
      version,
      credential,
    });
    return body.number('version');
  }

  /**
   * 웹 로그인의 한 걸음: 찾은 주소를 알리거나(url, userCode), 자격을 넘기거나(credential), 아무것도 없이 코드와 취소를 묻는다
   */
  async aiSignin(
    taskId: string,
    step: { url?: string; userCode?: string | null; credential?: string } = {},
  ): Promise<SigninReply> {
    const body = await this.mcp.call('ai_signin', {
      task_id: taskId,
      ...(step.url === undefined ? {} : { url: step.url }),
      ...(step.userCode ? { user_code: step.userCode } : {}),
      ...(step.credential === undefined ? {} : { credential: step.credential }),
    });
    return SigninReply.from(body);
  }

  async report(taskId: string, batch: ProgressBatch): Promise<ProgressState> {
    const body = await this.mcp.call('report_progress', {
      task_id: taskId,
      events: batch.events,
      ...(batch.requestId === null ? {} : { request_id: batch.requestId }),
      ...(batch.planUsage.length === 0 ? {} : { plan_usage: batch.planUsage }),
      ...(batch.model === null ? {} : { model: batch.model }),
    });
    return ProgressState.from(body);
  }

  async submit(taskId: string, result: RunResult): Promise<void> {
    await this.mcp.call('submit_result', {
      task_id: taskId,
      request_id: result.requestId,
      status: result.status,
      ...(result.text === null ? {} : { result: { text: result.text } }),
      ...(result.error === null ? {} : { error: result.error }),
    });
  }

  async release(taskId: string, reason: string): Promise<void> {
    await this.mcp.call('release_job', { task_id: taskId, reason });
  }

  /**
   * 결과물 하나를 올릴 표 (임대를 쥔 실행만). 본문은 표의 path에 PUT으로, 머리글 header: token을 붙여 보낸다.
   * 이름 · 한도를 넘으면 ToolRefused
   */
  async beginUpload(
    taskId: string,
    file: { name: string; size: number; sha256: string },
  ): Promise<{ path: string; header: string; token: string }> {
    const body = await this.mcp.call('begin_upload', {
      task_id: taskId,
      name: file.name,
      size: file.size,
      sha256: file.sha256,
    });
    return {
      path: body.text('upload_path'),
      header: body.text('header'),
      token: body.text('token'),
    };
  }

  /**
   * 만들기 작업의 재료 결과물 하나를 받을 표 (임대를 쥔 실행, 그 작업의 재료만). 휴지통에 갔으면 ToolRefused(not_found).
   * 본문은 표의 주소에서 GET으로 받는다 (MCP의 JSON으로 받지 않는다)
   */
  async beginDownload(
    taskId: string,
    outputId: string,
    stop?: AbortSignal,
  ): Promise<{
    path: string;
    header: string;
    token: string;
    name: string;
    size: number;
    sha256: string;
  }> {
    const body = await this.mcp.call(
      'begin_download',
      { task_id: taskId, output_id: outputId },
      0,
      stop,
    );
    return {
      path: body.text('download_path'),
      header: body.text('header'),
      token: body.text('token'),
      name: body.text('name'),
      size: body.number('size'),
      sha256: body.text('sha256'),
    };
  }

  /**
   * code-github: 빌린 code 작업의 저장소 토큰과, "고쳐 달라"로 다시 온 일이면 이미 연 PR (칸 러너만).
   * 패키지가 꺼져 있거나 토큰이 없으면 ToolRefused
   */
  async codeCredential(
    taskId: string,
    stop?: AbortSignal,
  ): Promise<{ token: string; apiUrl: string; pull: { number: number; branch: string } | null }> {
    const body = await this.mcp.call('code_credential', { task_id: taskId }, 0, stop);
    const pull = body.field('pull') ? body.child('pull') : null;
    return {
      token: body.text('token'),
      apiUrl: body.text('api_url'),
      pull: pull ? { number: pull.number('number'), branch: pull.text('branch') } : null,
    };
  }

  /** code-github: 연(고친) PR을 남긴다. 결재(code.pr.merge)는 받은 pull_id · version으로 올린다 */
  async codePullOpened(
    taskId: string,
    pull: {
      number: number;
      url: string;
      branch: string;
      headSha: string;
      checks: readonly { command: string; ok: boolean }[];
    },
  ): Promise<{ pullId: string; version: number }> {
    const body = await this.mcp.call('code_pull_opened', {
      task_id: taskId,
      number: pull.number,
      url: pull.url,
      branch: pull.branch,
      head_sha: pull.headSha,
      checks: pull.checks,
    });
    return { pullId: body.text('pull_id'), version: body.number('version') };
  }

  /**
   * 결재를 올린다. 작업 토큰(에이전트)으로 연 CairnServer에서만 부른다: 결재는 에이전트의 이름으로 올라가고,
   * 에이전트의 approval_actions에 그 동작이 있어야 한다 (없으면 ToolRefused)
   */
  async requestApproval(approval: {
    requestId: string;
    action: string;
    targetKind: string;
    targetId: string;
    targetVersion: number;
    note: string;
  }): Promise<string> {
    const body = await this.mcp.call('request_approval', {
      request_id: approval.requestId,
      action: approval.action,
      target_kind: approval.targetKind,
      target_id: approval.targetId,
      target_version: approval.targetVersion,
      note: approval.note,
    });
    return body.text('approval_id');
  }

  /** browser-tabs: 빌린 browse 작업이 어디서 도는지 (사이트 · 둘러보기). 패키지가 꺼져 있거나 사이트가 없으면 ToolRefused */
  async browserJob(taskId: string, stop?: AbortSignal): Promise<BrowseJob> {
    return BrowseJob.from(await this.mcp.call('browser_job', { task_id: taskId }, 0, stop));
  }

  /** browser-tabs: AI가 단계마다 찍은 화면 하나 (작업마다 30장, 넘으면 ToolRefused) */
  async saveShot(
    taskId: string,
    shot: { url: string; title: string; image: string },
  ): Promise<void> {
    await this.mcp.call('browser_shot_save', { task_id: taskId, ...shot });
  }

  /** browser-tabs: 로그인 화면을 만났다. 로그인 결재의 대상(사이트와 판)을 돌려준다 */
  async loginNeeded(
    taskId: string,
    page: { url: string; title: string; image: string | null },
  ): Promise<{ siteId: string; siteVersion: number }> {
    const body = await this.mcp.call('browser_login_needed', {
      task_id: taskId,
      page_url: page.url,
      page_title: page.title,
      ...(page.image ? { image: page.image } : {}),
    });
    return { siteId: body.text('site_id'), siteVersion: body.number('site_version') };
  }

  /** browser-tabs: 다시 찾은 마지막 버튼을 붙잡는다. 클릭 결재의 대상(클릭과 판)을 돌려준다 */
  async holdClick(
    taskId: string,
    held: HeldButton,
    note: string | null,
  ): Promise<{ clickId: string; version: number }> {
    const body = await this.mcp.call('browser_click_hold', {
      task_id: taskId,
      tab_id: held.tab.id,
      page_url: held.pageUrl,
      page_title: held.tab.title.slice(0, 300),
      role: held.button.role,
      name: held.button.name,
      nth: held.button.nth,
      box: held.box,
      fingerprint: held.fingerprint,
      ...(note ? { note } : {}),
      image: held.image,
    });
    return { clickId: body.text('click_id'), version: body.number('version') };
  }

  /** browser-tabs: 이 러너가 누를 승인된 클릭 하나 (없으면 null). 패키지가 꺼져 있으면 ToolRefused */
  async nextClick(stop: AbortSignal): Promise<ApprovedClick | null> {
    const body = await this.mcp.call('browser_click_next', {}, 0, stop);
    return body.field('click') ? ApprovedClick.from(body.child('click')) : null;
  }

  /** browser-tabs: 누른 결과(clicked) 또는 누르지 않은 까닭(changed)과 그때의 화면 */
  async saveClick(
    click: ApprovedClick,
    result: {
      outcome: string;
      reason: string | null;
      afterUrl: string | null;
      image: string | null;
    },
  ): Promise<void> {
    await this.mcp.call('browser_click_save', {
      id: click.id,
      version: click.version,
      outcome: result.outcome,
      ...(result.reason ? { reason: result.reason.slice(0, 500) } : {}),
      ...(result.afterUrl && /^https?:\/\//i.test(result.afterUrl)
        ? { after_url: result.afterUrl.slice(0, 2000) }
        : {}),
      ...(result.image ? { image: result.image } : {}),
    });
  }

  /** 읽어 달라는 브라우저 탭 주소들 (browser-tabs 패키지). 패키지가 꺼져 있으면 도구가 없어 ToolRefused */
  async pendingTabs(stop: AbortSignal): Promise<readonly { id: string; url: string }[]> {
    const body = await this.mcp.call('browser_tab_pending', {}, 0, stop);
    return body.list('reads').map((r) => ({ id: r.text('id'), url: r.text('url') }));
  }

  /** 읽은 탭을 남긴다. 읽지 못했으면 error만 */
  async saveTab(
    id: string,
    read: { title: string; body: string } | { error: string },
  ): Promise<void> {
    await this.mcp.call('browser_tab_save', { id, ...read });
  }
}
