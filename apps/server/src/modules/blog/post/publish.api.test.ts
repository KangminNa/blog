import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { ApiClient, type ApiResult, TestUser } from '../../../testing/api-client';
import {
  BaseHandler,
  CoreWorkers,
  Database,
  DomainEvent,
  Outbox,
  OutboxWorker,
} from '../../platform';
import { PublishApprovedHandler } from './publish-approved.handler';

// 결재한 공개: 가짜 러너가 작업을 빌려 초안을 쓰고 결재를 올리면, 주인이 정하고 일꾼이 outbox를 돌려 공개한다.
// 러너는 MCP로, 주인은 REST로 들어오고 이벤트는 outbox와 일꾼을 실제로 거친다. AI는 띄우지 않는다.

type Json = Record<string, unknown>;

type Job = {
  task: Json;
  skill: string;
  target: Json | null;
  revision_note: string | null;
  run_token: string;
};

/** 일꾼이 받는 쪽에 넘긴 이벤트. 결과는 outbox를 거쳐 받은 것만 본다 */
class Seen extends BaseHandler {
  readonly events: DomainEvent[] = [];

  async handle(event: DomainEvent): Promise<void> {
    this.events.push(event);
  }
}

const seen = new Seen();
let api: ApiClient;
let owner: TestUser;
let db: Database;
let worker: OutboxWorker;
/** run 권한을 준 기기 (러너) */
let runner: string;
/** write 권한을 준 기기 */
let writer: string;
/** 이 파일이 만든 에이전트 (끝나면 멈춘다) */
const agents: Json[] = [];

function ok(res: ApiResult, status = 200): Json {
  assert.equal(res.status, status, res.text);
  return res.json();
}

async function tool(token: string, name: string, args: Json = {}) {
  const res = await api.mcp(token, 'tools/call', { name, arguments: args });
  assert.equal(res.status, 200, res.text);
  const result = res.json().result as {
    isError?: boolean;
    content: { text: string }[];
    structuredContent?: Json;
  };
  return result.isError
    ? { ok: false, body: JSON.parse(result.content[0]?.text ?? '{}') as Json }
    : { ok: true, body: result.structuredContent ?? {} };
}

/** 도구를 부른다. 성공을 기대할 때 */
async function call(token: string, name: string, args: Json = {}): Promise<Json> {
  const { ok: done, body } = await tool(token, name, args);
  assert.equal(done, true, JSON.stringify(body));
  return body;
}

async function toolNames(token: string): Promise<string[]> {
  const res = await api.mcp(token, 'tools/list');
  assert.equal(res.status, 200, res.text);
  return (res.json().result as { tools: { name: string }[] }).tools.map((t) => t.name);
}

async function grant(name: string, scopes: readonly string[]): Promise<void> {
  const { devices } = ok(await api.get('/api/devices', owner)) as {
    devices: { id: string; name: string; scopes: string[]; version: number }[];
  };
  const device = devices.find((d) => d.name === name);
  ok(
    await api.request('PATCH', `/api/devices/${device?.id}`, owner, {
      scopes: [...(device?.scopes ?? []), ...scopes],
      version: device?.version,
    }),
  );
}

/** 초안을 쓰는 에이전트에게 맡긴 일을 러너가 빌린다 */
async function lease(approvalActions: readonly string[] = ['blog.post.publish']) {
  const agent = ok(
    await api.request('POST', '/api/agents', owner, {
      requestId: randomUUID(),
      name: '글쓰기',
      tool: 'claude',
      scopes: ['read_public', 'write'],
      approvalActions,
    }),
    201,
  );
  agents.push(agent);
  const task = ok(
    await api.request('POST', '/api/tasks', owner, {
      requestId: randomUUID(),
      agentId: agent.id,
      kind: 'draft_post',
      title: '소재로 초안 쓰기',
      instruction: '소재로 블로그 초안을 써 주세요',
    }),
    201,
  );
  const job = await take(task.id);
  assert.equal(job.skill, 'cairn-write');
  return { task, token: job.run_token };
}

/** 러너가 이 일을 빌린다. 앞 테스트 파일이 남긴 일이 먼저 올 수 있어서 이 일이 나올 때까지 빌린다 */
async function take(taskId: unknown): Promise<Job> {
  for (let i = 0; i < 50; i++) {
    const { jobs } = (await call(runner, 'next_jobs')) as { jobs: Job[] };
    const mine = jobs.find((j) => j.task.id === taskId);
    if (mine) return mine;
    if (jobs.length === 0) break;
  }
  throw new Error('맡긴 일을 빌리지 못했어요');
}

/** 스킬의 4·5장: 첫 초안을 저장하고 결재를 올린다 */
async function draftAndAsk(action = 'blog.post.publish') {
  const { task, token } = await lease([action]);
  const title = `결재할 글 ${randomUUID().slice(0, 8)}`;
  const saved = await call(token, 'blog_save_draft', {
    request_id: 'first-draft',
    title,
    body_md: '소재에서 읽은 본문',
    tags: ['cairn'],
  });
  const asked = await call(token, 'request_approval', {
    request_id: `approval-${saved.version}`,
    action,
    target_kind: 'post',
    target_id: saved.post_id,
    target_version: saved.version,
    note: '세션 하나로 썼어요',
  });
  assert.equal(asked.status, 'pending');
  const approval = ok(await api.get(`/api/approvals/${asked.approval_id}`, owner));
  return { task, token, postId: String(saved.post_id), title, approval };
}

const decide = (approval: Json, decision: string, note?: string) =>
  api.request('POST', `/api/approvals/${approval.id}/decide`, owner, {
    version: approval.version,
    decision,
    note,
  });

const getPost = async (id: unknown): Promise<Json> => ok(await api.get(`/api/posts/${id}`, owner));

const getTask = async (id: unknown): Promise<Json> => ok(await api.get(`/api/tasks/${id}`, owner));

/** 일꾼을 outbox가 빌 때까지 돌린다 */
async function drain(): Promise<void> {
  for (let i = 0; i < 200 && (await worker.tick()) > 0; i++);
}

/** 이 결재의 실행 결과로 받은 이벤트 */
function results(approvalId: unknown): DomainEvent[] {
  return seen.events.filter(
    (e) => e.name.startsWith('blog.post.') && e.data.approvalId === approvalId,
  );
}

/** 일꾼이 같은 승인을 또 받은 것처럼 받았던 이벤트를 outbox에 다시 남긴다 */
async function deliverAgain(approvalId: unknown): Promise<void> {
  const granted = seen.events.find(
    (e) => e.name === 'task.approval.granted' && e.data.approvalId === approvalId,
  );
  assert.ok(granted);
  await db.transaction((tx) => new Outbox(tx).publish([granted]));
  await drain();
}

before(async () => {
  api = await ApiClient.start();
  owner = await api.signIn();
  db = api.service(Database);
  worker = api.service(OutboxWorker);
  api.service(CoreWorkers).on('blog.post.*', seen);
  api.service(CoreWorkers).on('task.approval.granted', seen);
  const { version } = (await api.get('/api/space')).json() as { version: number };
  await api.request('PUT', '/api/space', owner, {
    name: '돌무더기',
    siteUrl: api.baseUrl,
    version,
  });
  runner = await api.connectDevice(owner, 'publish-runner');
  writer = await api.connectDevice(owner, 'publish-writer');
  await grant('publish-runner', ['run']);
  await grant('publish-writer', ['write']);
});

after(async () => {
  // 담당 없는 일은 가장 먼저 만든 움직이는 에이전트가 맡는다. 다음 테스트 파일의 일을 가져가지 않게 멈춘다
  for (const agent of agents)
    ok(
      await api.request('POST', `/api/agents/${agent.id}/pause`, owner, { version: agent.version }),
    );
  await drain();
  await api.close();
});

describe('결재한 공개', () => {
  test('작업 → 빌리기 → 초안 → 결재 → 승인 → 일꾼 → 공개 → 작업 완료', async () => {
    const { task, postId, approval, title } = await draftAndAsk();
    assert.equal((await getTask(task.id)).status, 'waiting');
    const draft = await getPost(postId);
    assert.equal(draft.status, 'draft');
    const bySlug = `/api/posts/by-slug/${encodeURIComponent(String(draft.slug))}`;
    assert.equal((await api.get(bySlug)).status, 404);

    // 승인만으로는 공개되지 않는다: 일꾼이 이벤트를 받아 실행한다
    assert.equal(ok(await decide(approval, 'approve')).status, 'approved');
    assert.equal((await getPost(postId)).status, 'draft');
    assert.equal((await getTask(task.id)).status, 'running');

    await drain();
    const post = await getPost(postId);
    assert.equal(post.status, 'published');
    assert.equal(typeof post.publishedAt, 'string');
    assert.equal(post.version, Number(draft.version) + 1);
    assert.equal(ok(await api.get(bySlug)).title, title);

    const finished = await getTask(task.id);
    assert.equal(finished.status, 'done');
    assert.equal(typeof finished.finishedAt, 'string');
    assert.equal((finished.events as Json[]).at(-1)?.kind, 'result');

    // 내용은 그대로라 판이 늘지 않고, 결과에는 원래 내용과 결재가 함께 간다
    const revisions = await db.sql`SELECT id FROM blog.post_revisions WHERE post_id = ${postId}`;
    assert.equal(revisions.length, 1);
    const [result, ...more] = results(approval.id);
    assert.equal(more.length, 0);
    assert.equal(result?.name, 'blog.post.published');
    assert.deepEqual(result?.data, {
      postId,
      slug: draft.slug,
      title,
      status: 'published',
      postVersion: post.version,
      mainWikiId: null,
      refWikiIds: [],
      approvalId: approval.id,
      outcome: 'done',
    });
  });

  test('승인 뒤 글이 바뀌면 공개하지 않고 작업은 실패로 끝난다', async () => {
    const { task, postId, title, approval } = await draftAndAsk();
    ok(await decide(approval, 'approve'));
    const before = await getPost(postId);
    ok(
      await api.request('PUT', `/api/posts/${postId}`, owner, {
        version: before.version,
        title,
        body: '주인이 고친 본문',
      }),
    );

    await drain();
    assert.equal((await getPost(postId)).status, 'draft');
    const finished = await getTask(task.id);
    assert.equal(finished.status, 'failed');
    assert.match(String((finished.result as Json).error), /바뀐 글이라 공개하지 않았어요/);
    assert.equal((finished.events as Json[]).at(-1)?.kind, 'error');
    const [result] = results(approval.id);
    assert.equal(result?.name, 'blog.post.publish_failed');
    assert.equal(result?.data.outcome, 'failed');
    assert.match(String(result?.data.error), /바뀐 글이라/);
  });

  test('승인을 기다리는 사이에 바뀌어도 같다', async () => {
    const { task, postId, title, approval } = await draftAndAsk();
    const before = await getPost(postId);
    ok(
      await api.request('PUT', `/api/posts/${postId}`, owner, {
        version: before.version,
        title,
        body: '결재 전에 고친 본문',
      }),
    );
    ok(await decide(approval, 'approve'));
    await drain();
    assert.equal((await getPost(postId)).status, 'draft');
    assert.equal((await getTask(task.id)).status, 'failed');
  });

  test('주인이 먼저 공개했으면 바뀐 글로 본다. 글은 공개 그대로', async () => {
    const { task, postId, approval } = await draftAndAsk();
    const before = await getPost(postId);
    ok(
      await api.request('POST', `/api/posts/${postId}/status`, owner, {
        version: before.version,
        status: 'published',
      }),
    );
    ok(await decide(approval, 'approve'));
    await drain();
    assert.equal((await getPost(postId)).status, 'published');
    assert.equal((await getTask(task.id)).status, 'failed');
  });

  test('링크만 공개한 글도 공개 범위가 바뀌었으니 공개하지 않는다', async () => {
    const { task, postId, approval } = await draftAndAsk();
    const before = await getPost(postId);
    ok(
      await api.request('POST', `/api/posts/${postId}/status`, owner, {
        version: before.version,
        status: 'unlisted',
      }),
    );
    ok(await decide(approval, 'approve'));
    await drain();
    assert.equal((await getPost(postId)).status, 'unlisted');
    assert.equal((await getTask(task.id)).status, 'failed');
  });

  test('휴지통에 넣은 글은 공개하지 않는다', async () => {
    const { task, postId, approval } = await draftAndAsk();
    ok(await decide(approval, 'approve'));
    const before = await getPost(postId);
    ok(
      await api.request('DELETE', `/api/posts/${postId}`, owner, {
        version: before.version,
      }),
    );
    await drain();
    const finished = await getTask(task.id);
    assert.equal(finished.status, 'failed');
    assert.deepEqual(finished.result, { error: '휴지통에 있는 글이라 공개하지 않았어요' });
    assert.equal((await getPost(postId)).status, 'draft');
  });

  test('없는 글을 결재해도 일꾼이 멈추지 않고 작업은 실패로 끝난다', async () => {
    const { task, token } = await lease();
    const asked = await call(token, 'request_approval', {
      request_id: 'approval-1',
      action: 'blog.post.publish',
      target_kind: 'post',
      target_id: randomUUID(),
      target_version: 1,
    });
    ok(await decide(ok(await api.get(`/api/approvals/${asked.approval_id}`, owner)), 'approve'));
    await drain();
    const finished = await getTask(task.id);
    assert.equal(finished.status, 'failed');
    assert.deepEqual(finished.result, { error: '없는 글이라 공개하지 않았어요' });
  });

  test('고쳐 달라고 하면 같은 글을 찾아 고치고 다시 올린다', async () => {
    const first = await draftAndAsk();
    ok(await decide(first.approval, 'revise', '제목을 바꿔 주세요'));
    await drain();
    assert.equal((await getPost(first.postId)).status, 'draft');
    assert.equal((await getTask(first.task.id)).status, 'queued');

    // 다음 실행은 앞 실행을 기억하지 못하므로 결재의 대상이 작업의 대상이 된다
    const job = await take(first.task.id);
    assert.equal(job.target?.id, first.postId);
    assert.equal(job.revision_note, '제목을 바꿔 주세요');
    const found = await call(job.run_token, 'blog_save_draft', {
      request_id: 'first-draft',
      title: '소재로 초안 쓰기',
      body_md: '소재로 초안 쓰기',
    });
    assert.equal(found.post_id, first.postId);
    const read = await call(job.run_token, 'blog_get_post', { post_id: first.postId });
    assert.equal(read.body_md, '소재에서 읽은 본문');

    const fixed = await call(job.run_token, 'blog_save_draft', {
      request_id: `fix-${read.version}`,
      post_id: first.postId,
      base_version: read.version,
      title: '바꾼 제목',
      body_md: read.body_md,
    });

    // 앞 결재의 request_id를 다시 쓰면 끝난 결재가 돌아온다: 스킬이 pending이 아니면 멈추는 까닭
    const stale = await call(job.run_token, 'request_approval', {
      request_id: `approval-${read.version}`,
      action: 'blog.post.publish',
      target_kind: 'post',
      target_id: first.postId,
      target_version: fixed.version,
    });
    assert.equal(stale.status, 'revision_requested');

    const asked = await call(job.run_token, 'request_approval', {
      request_id: `approval-${fixed.version}`,
      action: 'blog.post.publish',
      target_kind: 'post',
      target_id: first.postId,
      target_version: fixed.version,
    });
    assert.equal(asked.status, 'pending');
    ok(await decide(ok(await api.get(`/api/approvals/${asked.approval_id}`, owner)), 'approve'));
    await drain();
    const post = await getPost(first.postId);
    assert.equal(post.status, 'published');
    assert.equal(post.title, '바꾼 제목');
    assert.equal((await getTask(first.task.id)).status, 'done');
    assert.equal(results(first.approval.id).length, 0);
  });

  test('거절한 결재는 아무것도 공개하지 않는다', async () => {
    const { task, postId, approval } = await draftAndAsk();
    ok(await decide(approval, 'reject', '안 올려요'));
    await drain();
    assert.equal((await getPost(postId)).status, 'draft');
    assert.equal((await getTask(task.id)).status, 'cancelled');
    assert.equal(results(approval.id).length, 0);
  });

  test('다른 동작의 승인은 받지 않는다', async () => {
    const { task, postId, approval } = await draftAndAsk('sns.post.send');
    ok(await decide(approval, 'approve'));
    await drain();
    assert.equal((await getPost(postId)).status, 'draft');
    assert.equal(results(approval.id).length, 0);
    assert.equal((await getTask(task.id)).status, 'running');
  });
});

describe('같은 승인이 두 번 올 때', () => {
  test('공개는 한 번이고 같은 결과를 다시 낸다. 작업도 그대로', async () => {
    const { task, postId, approval } = await draftAndAsk();
    ok(await decide(approval, 'approve'));
    await drain();
    const post = await getPost(postId);

    await deliverAgain(approval.id);
    const again = await getPost(postId);
    assert.equal(again.version, post.version);
    assert.equal(again.publishedAt, post.publishedAt);
    assert.equal((await getTask(task.id)).status, 'done');
    const [first, second, ...more] = results(approval.id);
    assert.equal(more.length, 0);
    assert.equal(second?.name, 'blog.post.published');
    assert.deepEqual(second?.data, first?.data);
  });

  test('공개한 뒤 주인이 내렸으면 다시 공개하지 않는다', async () => {
    const { postId, approval } = await draftAndAsk();
    ok(await decide(approval, 'approve'));
    await drain();
    const post = await getPost(postId);
    const lowered = ok(
      await api.request('POST', `/api/posts/${postId}/status`, owner, {
        version: post.version,
        status: 'draft',
      }),
    );

    await deliverAgain(approval.id);
    const again = await getPost(postId);
    assert.equal(again.status, 'draft');
    assert.equal(again.version, lowered.version);
  });

  test('실패도 같은 실패로 남는다', async () => {
    const { task, postId, title, approval } = await draftAndAsk();
    ok(await decide(approval, 'approve'));
    const before = await getPost(postId);
    ok(
      await api.request('PUT', `/api/posts/${postId}`, owner, {
        version: before.version,
        title,
        body: '주인이 고친 본문',
      }),
    );
    await drain();
    const failed = await getTask(task.id);

    await deliverAgain(approval.id);
    assert.equal((await getPost(postId)).status, 'draft');
    assert.deepEqual((await getTask(task.id)).result, failed.result);
    const [first, second] = results(approval.id);
    assert.equal(second?.name, 'blog.post.publish_failed');
    assert.deepEqual(second?.data, first?.data);
  });
});

describe('공개하는 길', () => {
  test('사람의 공개에는 결재 결과가 붙지 않는다', async () => {
    const created = ok(
      await api.request('POST', '/api/posts', owner, {
        requestId: randomUUID(),
        title: `사람이 올린 글 ${randomUUID().slice(0, 8)}`,
        body: '본문',
      }),
      201,
    );
    ok(
      await api.request('POST', `/api/posts/${created.id}/status`, owner, {
        version: created.version,
        status: 'published',
      }),
    );
    await drain();
    const event = seen.events.find(
      (e) => e.name === 'blog.post.published' && e.data.postId === created.id,
    );
    assert.ok(event);
    assert.equal('approvalId' in event.data, false);
    assert.equal('outcome' in event.data, false);
  });

  test('write 권한의 기기와 작업 토큰에는 공개하는 길이 없다', async () => {
    const { token, postId } = await draftAndAsk();
    const post = await getPost(postId);
    const asDevice = await api.request(
      'POST',
      `/api/posts/${postId}/status`,
      TestUser.visitor,
      { version: post.version, status: 'published' },
      { authorization: `Bearer ${writer}` },
    );
    assert.equal(asDevice.status, 403);
    const asRun = await api.request(
      'POST',
      `/api/posts/${postId}/status`,
      TestUser.visitor,
      { version: post.version, status: 'published' },
      { authorization: `Bearer ${token}` },
    );
    assert.equal(asRun.status, 403);
    assert.equal((await getPost(postId)).status, 'draft');
  });

  test('일꾼이 뜰 때 승인을 받는 쪽이 있다', async () => {
    const core = api.service(CoreWorkers);
    assert.deepEqual(core.missing(), []);
    const granted = new DomainEvent('task.approval.granted', 1, randomUUID(), {});
    const handlers = core.handlersFor(granted);
    assert.ok(handlers.some((h) => h instanceof PublishApprovedHandler));
  });
});

describe('cairn-write 스킬', () => {
  const SKILL = resolve(process.cwd(), '../../skills/cairn-write/SKILL.md');

  test('스킬이 부르는 도구는 모두 있고, 초안을 쓰는 에이전트에게 보인다', async () => {
    assert.equal(existsSync(SKILL), true);
    const text = readFileSync(SKILL, 'utf8');
    assert.match(text, /^---\nname: cairn-write\n/);
    assert.equal(text.includes('scripts/'), false);
    const { token } = await lease();
    const names = await toolNames(token);
    for (const name of [
      'basket_get',
      'search_sessions',
      'get_session',
      'blog_get_post',
      'blog_save_draft',
      'request_approval',
    ]) {
      assert.ok(text.includes(`\`${name}\``), `스킬에 없는 도구: ${name}`);
      assert.ok(names.includes(name), `에이전트에게 없는 도구: ${name}`);
    }
  });

  test('앱용 묶음은 폴더만 있으면 만들어진다', async () => {
    assert.equal((await api.get('/api/skills/cairn-write.zip', owner)).status, 200);
  });
});
