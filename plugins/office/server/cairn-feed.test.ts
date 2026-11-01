import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CairnFeed, type FeedSnapshot, type FeedTask, readDesks } from '../web/cairn-feed';
import type { ServerMessage } from '../web/pixel/messages';

// 플러그인 테스트 자리(server/*.test.ts)에 둔다. 이 플러그인에 서버 코드는 없고, 웹의 cairn-feed.ts만 시험한다.

const A = '019a0000-0000-7000-8000-00000000000a';
const B = '019a0000-0000-7000-8000-00000000000b';

function snapshot(more: Partial<FeedSnapshot> = {}): FeedSnapshot {
  return {
    agents: [
      { id: A, name: 'writer', status: 'active' },
      { id: B, name: 'research', status: 'active' },
    ],
    running: [],
    waiting: [],
    held: [],
    events: {},
    ...more,
  };
}

function task(id: string, agentId: string | null, lastEvent: string | null = null): FeedTask {
  return { id, agentId, title: `제목 ${id}`, lastEvent };
}

/** 처음 상태를 넘긴 뒤 보내는 메시지를 모은다 */
function started(first = snapshot()) {
  const feed = new CairnFeed();
  feed.push(first);
  const sent: ServerMessage[] = [];
  feed.onMessage((message) => sent.push(message));
  sent.length = 0;
  return { feed, sent };
}

describe('오피스 피드', () => {
  it('처음 읽으면 도구 분류, 자리와 함께 있는 에이전트, 각자의 동작을 보낸다', () => {
    const feed = new CairnFeed();
    const sent: ServerMessage[] = [];
    feed.onMessage((message) => sent.push(message));
    feed.push(snapshot());

    assert.deepEqual(sent, [
      { type: 'providerCapabilities', readingTools: ['Read'], subagentToolNames: [] },
      {
        type: 'existingAgents',
        agents: [1, 2],
        agentMeta: {
          1: { palette: 0, hueShift: 0, seatId: 'seat-0' },
          2: { palette: 1, hueShift: 0, seatId: 'seat-1' },
        },
        directoryNames: {},
        externalAgents: {},
      },
      { type: 'agentStatus', id: 1, status: 'waiting' },
      { type: 'agentStatus', id: 2, status: 'waiting' },
    ]);
  });

  it('에이전트 차례는 목록 순서가 아니라 id 순서라 다시 열어도 같은 자리다', () => {
    const feed = new CairnFeed();
    const desks = feed.push(snapshot({ agents: [...snapshot().agents].reverse() }));
    assert.deepEqual(
      desks.map((d) => [d.pixelId, d.name]),
      [
        [1, 'writer'],
        [2, 'research'],
      ],
    );
  });

  it('실행 중이고 읽기 기록이 마지막이면 앉아서 읽는다', () => {
    const { feed, sent } = started();
    feed.push(snapshot({ running: [task('t1', A)], events: { t1: ['write', 'read'] } }));
    assert.deepEqual(sent, [
      { type: 'agentStatus', id: 1, status: 'active' },
      { type: 'agentToolStart', id: 1, toolId: 't1:Read', status: 'Reading', toolName: 'Read' },
    ]);
  });

  it('쓰기 기록이 마지막이거나 기록이 없으면 입력한다', () => {
    for (const kinds of [['read', 'write', 'result'], []]) {
      const { feed, sent } = started();
      feed.push(snapshot({ running: [task('t1', A)], events: { t1: kinds } }));
      assert.deepEqual(sent[1], {
        type: 'agentToolStart',
        id: 1,
        toolId: 't1:Write',
        status: 'Writing',
        toolName: 'Write',
      });
    }
  });

  it('같은 값을 다시 읽으면 아무것도 보내지 않는다', () => {
    const value = snapshot({ running: [task('t1', A)], events: { t1: ['read'] } });
    const { feed, sent } = started(value);
    feed.push(value);
    assert.deepEqual(sent, []);
  });

  it('읽다가 쓰기로 바뀌면 앞 도구를 끝내고 새 도구를 시작한다', () => {
    const { feed, sent } = started(
      snapshot({ running: [task('t1', A)], events: { t1: ['read'] } }),
    );
    feed.push(snapshot({ running: [task('t1', A)], events: { t1: ['read', 'write'] } }));
    assert.deepEqual(sent, [
      { type: 'agentToolDone', id: 1, toolId: 't1:Read' },
      { type: 'agentToolStart', id: 1, toolId: 't1:Write', status: 'Writing', toolName: 'Write' },
    ]);
  });

  it('결재 대기가 되면 앉은 채 말풍선을 띄우고, 다시 실행되면 말풍선을 치운다', () => {
    const { feed, sent } = started(
      snapshot({ running: [task('t1', A)], events: { t1: ['write'] } }),
    );
    feed.push(snapshot({ waiting: [task('t1', A)] }));
    assert.deepEqual(sent, [{ type: 'agentToolPermission', id: 1 }]);

    sent.length = 0;
    feed.push(snapshot({ running: [task('t1', A)], events: { t1: ['read'] } }));
    assert.deepEqual(sent, [
      { type: 'agentToolPermissionClear', id: 1 },
      { type: 'agentToolStart', id: 1, toolId: 't1:Read', status: 'Reading', toolName: 'Read' },
    ]);
  });

  it('쉬던 에이전트가 결재 대기가 되면 자리로 가서 말풍선을 띄운다', () => {
    const { feed, sent } = started();
    feed.push(snapshot({ waiting: [task('t1', B)] }));
    assert.deepEqual(sent, [
      { type: 'agentStatus', id: 2, status: 'active' },
      { type: 'agentToolPermission', id: 2 },
    ]);
  });

  it('작업이 끝나면 도구를 치우고 쉰다', () => {
    const { feed, sent } = started(
      snapshot({ running: [task('t1', A)], events: { t1: ['write'] } }),
    );
    feed.push(snapshot());
    assert.deepEqual(sent, [
      { type: 'agentToolsClear', id: 1 },
      { type: 'agentStatus', id: 1, status: 'waiting' },
    ]);
  });

  it('멈췄거나 쉬는 에이전트는 실행 중 작업이 남아 있어도 쉰다', () => {
    const paused = snapshot({
      agents: [{ id: A, name: 'writer', status: 'paused' }],
      running: [task('t1', A)],
    });
    assert.equal(readDesks(paused)[0]?.state, 'paused');

    const held = snapshot({ held: [A], running: [task('t1', A)] });
    assert.equal(readDesks(held)[0]?.state, 'held');

    const { feed, sent } = started(
      snapshot({ running: [task('t1', A)], events: { t1: ['write'] } }),
    );
    feed.push(held);
    assert.deepEqual(sent, [
      { type: 'agentToolsClear', id: 1 },
      { type: 'agentStatus', id: 1, status: 'waiting' },
    ]);
  });

  it('멈춘 에이전트라도 결재 대기가 있으면 말풍선이 앞선다', () => {
    const value = snapshot({
      agents: [{ id: A, name: 'writer', status: 'paused' }],
      waiting: [task('t1', A)],
    });
    assert.equal(readDesks(value)[0]?.state, 'waiting');
  });

  it('맡은 에이전트가 없는 작업은 캐릭터에 닿지 않는다', () => {
    const desks = readDesks(snapshot({ running: [task('t1', null)] }));
    assert.deepEqual(
      desks.map((d) => d.state),
      ['idle', 'idle'],
    );
  });

  it('새 에이전트는 자리와 함께 만들고, 사라진 에이전트는 닫는다', () => {
    const { feed, sent } = started(
      snapshot({ agents: [{ id: A, name: 'writer', status: 'active' }] }),
    );
    feed.push(snapshot({ agents: [{ id: B, name: 'research', status: 'active' }] }));
    assert.deepEqual(sent, [
      { type: 'agentClosed', id: 1 },
      { type: 'agentCreated', id: 2, palette: 1, hueShift: 0, seatId: 'seat-1' },
      { type: 'agentStatus', id: 2, status: 'waiting' },
    ]);
  });

  it('화면이 늦게 붙어도 지금 상태를 처음부터 받는다', () => {
    const feed = new CairnFeed();
    feed.push(snapshot({ waiting: [task('t1', A)] }));
    const sent: ServerMessage[] = [];
    feed.onMessage((message) => sent.push(message));
    assert.deepEqual(
      sent.map((m) => m.type),
      [
        'providerCapabilities',
        'existingAgents',
        'agentStatus',
        'agentToolPermission',
        'agentStatus',
      ],
    );
  });

  it('캐릭터를 누르면 열 작업은 결재 대기가 먼저이고, 없으면 null이다', () => {
    const feed = new CairnFeed();
    feed.push(snapshot({ running: [task('run', A)], waiting: [task('wait', A)] }));
    assert.equal(feed.taskOf(1), 'wait');
    assert.equal(feed.taskOf(2), null);
    assert.equal(feed.taskOf(99), null);
  });
});
