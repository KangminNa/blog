import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { ApiClient, type ApiResult, TestUser } from '../../../testing/api-client';
import { OutboxWorker } from '../../platform';

// 프로젝트별 원문 모으기 (2차 4단계): 관리자가 프로젝트마다 켜고 끈다. 끈 프로젝트의 원문은 쌓지 않는다 (skipped).
// REST는 관리자만 (방문자 403 · 기기 토큰은 REST에서 방문자와 같다)

// biome-ignore lint/suspicious/noExplicitAny: 응답 JSON을 여러 겹 읽는 시험 (모양은 assert가 본다)
type Json = Record<string, any>;

let api: ApiClient;
let owner: TestUser;
let collector: string;
let writer: string;

function ok(res: ApiResult, status = 200): Json {
  assert.equal(res.status, status, res.text);
  return res.json();
}

async function upload(project: string, text: string): Promise<Json> {
  const res = await api.mcp(collector, 'tools/call', {
    name: 'save_transcript',
    arguments: {
      request_id: randomUUID(),
      tool: 'claude-code',
      source_session_id: `rule-${randomUUID()}`,
      project,
      text,
    },
  });
  assert.equal(res.status, 200, res.text);
  return (res.json().result as Json).structuredContent as Json;
}

before(async () => {
  api = await ApiClient.start();
  owner = await api.signIn();
  writer = await api.writeDevice(owner, 'rule-writer');
  collector = await api.connectDevice(owner, 'rule-collector', 'collect');
});
after(async () => {
  const worker = api.service(OutboxWorker);
  for (let i = 0; i < 200 && (await worker.tick()) > 0; i++);
  await api.close();
});

describe('프로젝트 규칙', () => {
  test('방문자 · 기기는 보지도 바꾸지도 못한다', async () => {
    assert.equal((await api.get('/api/project-rules')).status, 403);
    const put = await api.request('PUT', '/api/project-rules', TestUser.visitor, {
      project: 'x',
      collect: false,
    });
    assert.equal(put.status, 403);
    const bearer = await fetch(`${api.baseUrl}/api/project-rules`, {
      headers: { authorization: `Bearer ${writer}` },
    });
    assert.equal(bearer.status, 403, '기기 토큰은 REST에서 방문자와 같다');
  });

  test('세션에 나온 프로젝트가 목록에 보이고, 끄면 그 프로젝트의 원문은 쌓지 않는다. 다시 켜면 쌓는다', async () => {
    const project = `proj-${randomUUID().slice(0, 8)}`;
    assert.equal((await upload(project, '## 사람\n첫 원문')).status, 'saved');
    const listed = ok(await api.get('/api/project-rules', owner)).projects as Json[];
    const line = listed.find((p) => p.project === project);
    assert.deepEqual([line?.collect, line?.sessions], [true, 1]);

    const off = ok(
      await api.request('PUT', '/api/project-rules', owner, { project, collect: false }),
    );
    assert.equal((off.projects as Json[]).find((p) => p.project === project)?.collect, false);
    const skipped = await upload(project, '## 사람\n모으지 않을 원문');
    assert.deepEqual([skipped.status, skipped.session_id], ['skipped', null]);

    ok(await api.request('PUT', '/api/project-rules', owner, { project, collect: true }));
    assert.equal((await upload(project, '## 사람\n다시 모을 원문')).status, 'saved');
    const bad = await api.request('PUT', '/api/project-rules', owner, {
      project: '',
      collect: 'no',
    });
    assert.equal(bad.status, 400);
  });
});
