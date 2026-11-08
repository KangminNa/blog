import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { ApiClient, TestUser } from '../../../testing/api-client';

// 기능 패키지의 입구 (/api/p/<패키지>/…, MCP 도구): 첫 패키지 browser-tabs로 본다.
// 꺼져 있으면 경로 · 도구가 없는 것과 같고, 켜면 목록 파일의 경로 · 도구가 열린다. 보는 사람별: 방문자 · write 기기 · 러너 · 주인.

type Json = Record<string, unknown>;
const PATH = '/api/p/browser-tabs/reads';

let api: ApiClient;
let owner: TestUser;
let writer: Readonly<Record<string, string>>;
let runner: string;

before(async () => {
  api = await ApiClient.start();
  owner = await api.signIn();
  writer = { authorization: `Bearer ${await api.writeDevice(owner, 'tabs-writer')}` };
  const made = await api.request('POST', '/api/devices/runner', owner, {
    requestId: randomUUID(),
    name: '탭 러너',
  });
  assert.equal(made.status, 201, made.text);
  runner = String(made.json().token);
  const on = await api.request('POST', '/api/plugins/browser-tabs/enable', owner);
  assert.equal(on.status, 200, on.text);
});
after(() => api.close());

async function tool(
  token: string,
  name: string,
  args: Json = {},
): Promise<{ ok: boolean; body: Json }> {
  const res = await api.mcp(token, 'tools/call', { name, arguments: args });
  assert.equal(res.status, 200, res.text);
  const result = res.json().result as {
    isError?: boolean;
    content: { text: string }[];
    structuredContent?: Json;
  };
  return result.isError
    ? { ok: false, body: JSON.parse(result.content[0]?.text ?? '{}') }
    : { ok: true, body: result.structuredContent ?? {} };
}

async function toolNames(token: string): Promise<string[]> {
  const res = await api.mcp(token, 'tools/list');
  return (res.json().result as { tools: { name: string }[] }).tools.map((t) => t.name);
}

describe('기능 패키지 (browser-tabs)', () => {
  test('방문자와 write 기기는 주인만인 동작을 못 한다 (403), 없는 경로는 404', async () => {
    for (const headers of [{}, writer]) {
      const list = await api.request('GET', PATH, TestUser.visitor, undefined, headers);
      assert.equal(list.status, 403, list.text);
      const made = await api.request(
        'POST',
        PATH,
        TestUser.visitor,
        { url: 'https://a.example' },
        headers,
      );
      assert.equal(made.status, 403, made.text);
    }
    assert.equal((await api.request('GET', '/api/p/browser-tabs/nope', owner)).status, 404);
    assert.equal((await api.request('GET', '/api/p/no-such-package/reads', owner)).status, 404);
  });

  test('주인이 요청하면 러너가 MCP로 받아 읽고 남기고, 주인 목록에 결과가 보인다', async () => {
    const made = await api.request('POST', PATH, owner, { url: 'https://news.example/today' });
    assert.ok([200, 201].includes(made.status), made.text);

    const pending = await tool(runner, 'browser_tab_pending');
    assert.equal(pending.ok, true, JSON.stringify(pending.body));
    const asked = (pending.body.reads as { id: string; url: string }[]).find(
      (r) => r.url === 'https://news.example/today',
    );
    assert.ok(asked, '요청한 주소가 러너에게 간다');

    const saved = await tool(runner, 'browser_tab_save', {
      id: asked.id,
      title: '오늘',
      body: '본문',
    });
    assert.deepEqual(saved.body, { id: asked.id, status: 'done' });
    const again = await tool(runner, 'browser_tab_save', { id: asked.id, title: '두 번째' });
    assert.equal(again.ok, false, '요청 하나에 한 번만 남긴다');

    const list = (await api.get(PATH, owner)).json().reads as Json[];
    const shown = list.find((r) => r.id === asked.id);
    assert.equal(shown?.status, 'done');
    assert.equal(shown?.title, '오늘');
  });

  test('모양이 틀리면 400과 고칠 칸, http · https만', async () => {
    const empty = await api.request('POST', PATH, owner, {});
    assert.equal(empty.status, 400, empty.text);
    assert.ok((empty.json().fields as Json).url);
    assert.equal((await api.request('POST', PATH, owner, { url: 'ftp://x' })).status, 422);
  });

  test('러너에게는 러너 도구만 보이고, 끄면 경로와 도구가 사라진다', async () => {
    const names = await toolNames(runner);
    assert.ok(names.includes('browser_tab_pending') && names.includes('browser_tab_save'));
    const off = await api.request('POST', '/api/plugins/browser-tabs/disable', owner);
    assert.equal(off.status, 200, off.text);
    assert.equal((await api.request('GET', PATH, owner)).status, 404);
    assert.equal((await toolNames(runner)).includes('browser_tab_pending'), false);
    await api.request('POST', '/api/plugins/browser-tabs/enable', owner);
  });
});
