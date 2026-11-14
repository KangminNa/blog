import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Conversations } from '../src/conversations.js';
import { badgeText, Inbox } from '../src/inbox.js';
import { MemoryStore } from './fakes.js';

/** 부른 도구를 적고, 정해 둔 답을 주는 MCP */
function fakeMcp(answer = { status: 'saved' }) {
  const calls = [];
  return {
    calls,
    call: async (name, args) => {
      calls.push({ name, args });
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
}

const online = { connected: async () => true };
const capture = {
  tool: 'chatgpt-web',
  conversationId: '6750a1b2-0000-8000-9000-00000000c0de',
  title: '피보나치',
  messages: [
    { role: 'person', text: '피보나치 함수를 짜 줘' },
    { role: 'ai', text: '여기 있어요' },
  ],
};
const FROM = 'https://chatgpt.com/c/6750a1b2-0000-8000-9000-00000000c0de';

describe('웹 AI 대화 올리기', () => {
  it('대화 하나를 save_transcript로 올린다', async () => {
    const mcp = fakeMcp();
    const conversations = new Conversations({ store: new MemoryStore(), mcp, connection: online });
    assert.deepEqual(await conversations.receive(capture, FROM), { status: 'saved' });
    assert.equal(mcp.calls.length, 1);
    const { name, args } = mcp.calls[0];
    assert.equal(name, 'save_transcript');
    assert.match(args.request_id, /^[0-9a-f-]{36}$/);
    assert.deepEqual(
      { ...args, request_id: undefined },
      {
        request_id: undefined,
        tool: 'chatgpt-web',
        source_session_id: capture.conversationId,
        title: '피보나치',
        text: '## 사람\n\n피보나치 함수를 짜 줘\n\n## AI\n\n여기 있어요',
      },
    );
  });

  it('같은 내용은 다시 올리지 않고, 바뀌면 다시 올린다', async () => {
    const mcp = fakeMcp({ status: 'unchanged' });
    const store = new MemoryStore();
    const conversations = new Conversations({ store, mcp, connection: online });
    await conversations.receive(capture, FROM);
    assert.deepEqual(await conversations.receive(capture, FROM), { status: 'same' });
    const longer = {
      ...capture,
      messages: [...capture.messages, { role: 'person', text: '고마워' }],
    };
    await conversations.receive(longer, FROM);
    assert.equal(mcp.calls.length, 2);
    assert.notEqual(mcp.calls[0].args.request_id, mcp.calls[1].args.request_id);
    assert.equal(Object.keys(store.items.seen).length, 1);
  });

  it('서버가 거절하면 기억하지 않는다 (다음에 다시 보낸다)', async () => {
    const store = new MemoryStore();
    const failing = new Conversations({
      store,
      mcp: fakeMcp(new Error('down')),
      connection: online,
    });
    await assert.rejects(failing.receive(capture, FROM));
    assert.equal(store.items.seen, undefined);
  });

  it('제목이 없으면 빼고 보낸다', async () => {
    const mcp = fakeMcp();
    const conversations = new Conversations({ store: new MemoryStore(), mcp, connection: online });
    await conversations.receive({ ...capture, title: '  ' }, FROM);
    assert.equal('title' in mcp.calls[0].args, false);
  });

  it('다른 사이트의 페이지가 보낸 대화는 받지 않는다', async () => {
    const mcp = fakeMcp();
    const conversations = new Conversations({ store: new MemoryStore(), mcp, connection: online });
    await assert.rejects(
      conversations.receive(capture, 'https://claude.ai/chat/x'),
      /이 사이트의 대화가 아니에요/,
    );
    await assert.rejects(conversations.receive({ ...capture, tool: 'other' }, FROM));
    assert.equal(mcp.calls.length, 0);
  });

  it('끈 사이트 · 연결 없음 · 대화 id 없음 · 빈 대화는 올리지 않는다', async () => {
    const mcp = fakeMcp();
    const store = new MemoryStore();
    const conversations = new Conversations({ store, mcp, connection: online });
    assert.deepEqual(await conversations.setSites({ 'chatgpt-web': false, nope: true }), {
      'chatgpt-web': false,
      'claude-web': true,
      'gemini-web': true,
    });
    assert.deepEqual(await conversations.receive(capture, FROM), { status: 'off' });
    const offline = new Conversations({
      store: new MemoryStore(),
      mcp,
      connection: { connected: async () => false },
    });
    assert.deepEqual(await offline.receive(capture, FROM), { status: 'off' });
    const fresh = new Conversations({ store: new MemoryStore(), mcp, connection: online });
    assert.deepEqual(await fresh.receive({ ...capture, conversationId: '' }, FROM), {
      status: 'ignored',
    });
    assert.deepEqual(await fresh.receive({ ...capture, messages: [] }, FROM), {
      status: 'empty',
    });
    assert.equal(mcp.calls.length, 0);
  });
});

describe('기다리는 결재 배지', () => {
  it('배지 글자', () => {
    assert.equal(badgeText(0), '');
    assert.equal(badgeText(3), '3');
    assert.equal(badgeText(150), '99+');
  });

  it('결재 + 질문 수를 배지에 적는다', async () => {
    const badges = [];
    const inbox = new Inbox({
      mcp: fakeMcp({ approvals: 2, questions: 1 }),
      connection: online,
      badge: async (text) => badges.push(text),
    });
    assert.deepEqual(await inbox.refresh(), { approvals: 2, questions: 1 });
    assert.deepEqual(badges, ['3']);
  });

  it('연결이 없거나 끊기면 배지를 비운다', async () => {
    const badges = [];
    const badge = async (text) => badges.push(text);
    const offline = new Inbox({
      mcp: fakeMcp(),
      connection: { connected: async () => false },
      badge,
    });
    assert.equal(await offline.refresh(), null);
    const lost = Object.assign(new Error('끊김'), { code: 'lost' });
    await assert.rejects(new Inbox({ mcp: fakeMcp(lost), connection: online, badge }).refresh());
    assert.deepEqual(badges, ['', '']);
  });
});
