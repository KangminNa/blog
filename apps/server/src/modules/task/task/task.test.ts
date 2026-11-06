import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, test } from 'node:test';
import { AgentActor, Conflict, Forbidden, RuleViolation, SecretBox } from '../../platform';
import { Agent } from '../agent/agent';
import { Task } from './task';

// 작업의 상태 기계: 허용된 변경만 메서드로 받고, 나머지는 RuleViolation. DB 없이 돈다.

const NOW = new Date('2026-11-01T00:00:00Z');
const LATER = new Date(NOW.getTime() + Task.LEASE_MS + 1);
const RUNNER = 'runner-1';
const POST = '00000000-0000-7000-8000-0000000000a1';
const AGENT = 'agent-1';

function queued(): Task {
  return Task.open(
    'space',
    AGENT,
    'draft_post',
    '글 쓰기',
    '지시',
    {},
    null,
    null,
    null,
    0,
    randomUUID(),
    null,
    NOW,
  );
}

function running(): Task {
  const task = queued();
  task.lease(RUNNER, AGENT, NOW);
  return task;
}

function waiting(): Task {
  const task = running();
  task.waitFor(NOW);
  return task;
}

describe('작업 상태', () => {
  test('queued → running → waiting → running → done', () => {
    const task = queued();
    assert.equal(task.status, Task.QUEUED);
    task.lease(RUNNER, AGENT, NOW);
    assert.equal(task.status, Task.RUNNING);
    assert.equal(task.attempts, 1);
    assert.equal(task.leasedBy, RUNNER);
    task.waitFor(NOW);
    assert.equal(task.status, Task.WAITING);
    task.resume();
    assert.equal(task.status, Task.RUNNING);
    assert.equal(task.leaseUntil, null);
    task.finish({ ok: true }, NOW);
    assert.equal(task.status, Task.DONE);
    assert.equal(task.finishedAt, NOW);
  });

  test('끝난 작업은 어떤 상태로도 가지 않는다', () => {
    const done = running();
    done.finish({}, NOW);
    const failed = running();
    failed.fail('이유', NOW);
    const cancelled = running();
    cancelled.cancel(NOW);
    for (const task of [done, failed, cancelled]) {
      assert.throws(() => task.cancel(NOW), RuleViolation);
      assert.throws(() => task.finish({}, NOW), RuleViolation);
      assert.throws(() => task.lease(RUNNER, AGENT, NOW), RuleViolation);
    }
  });

  test('허용되지 않은 변경은 거절한다', () => {
    assert.throws(() => queued().finish({}, NOW), RuleViolation);
    assert.throws(() => queued().waitFor(NOW), RuleViolation);
    assert.throws(() => queued().resume(), RuleViolation);
    assert.throws(() => running().lease(RUNNER, AGENT, NOW), RuleViolation);
    assert.throws(() => waiting().finish({}, NOW), RuleViolation);
    assert.throws(() => waiting().fail('이유', NOW), RuleViolation);
    // 상태 쌍은 있어도 그 메서드의 길이 아니면 막는다
    assert.throws(() => waiting().lease(RUNNER, AGENT, NOW), RuleViolation);
    assert.throws(() => running().resume(), RuleViolation);
    assert.throws(() => running().returnForRevision('다시', 'post', POST, 2), RuleViolation);
    assert.throws(() => queued().returnForRevision('다시', 'post', POST, 2), RuleViolation);
  });

  test('상태에는 set이 없다', () => {
    const task = queued() as unknown as { status: string };
    assert.throws(() => {
      task.status = Task.DONE;
    }, TypeError);
  });

  test('임대를 쥔 러너가 살아 있는 임대로만 끝낼 수 있다', () => {
    assert.throws(() => running().submit('다른 러너', Task.DONE, {}, null, NOW), RuleViolation);
    assert.throws(() => running().submit(RUNNER, Task.DONE, {}, null, LATER), RuleViolation);
    const task = running();
    task.submit(RUNNER, Task.DONE, { ok: true }, null, NOW);
    assert.equal(task.status, Task.DONE);
    const failed = running();
    failed.submit(RUNNER, Task.FAILED, {}, '실패 이유', NOW);
    assert.equal(failed.status, Task.FAILED);
    assert.deepEqual(failed.result, { error: '실패 이유' });
  });

  test('진행 보고는 임대를 늘린다. 취소·결재 대기는 기록만 받는다', () => {
    const task = running();
    const later = new Date(NOW.getTime() + 60_000);
    task.acceptReport(RUNNER, later);
    assert.equal(task.leaseUntil?.getTime(), later.getTime() + Task.LEASE_MS);

    const held = waiting();
    const lease = held.leaseUntil;
    held.acceptReport(RUNNER, later);
    assert.equal(held.leaseUntil, lease);

    const cancelled = running();
    cancelled.cancel(NOW);
    cancelled.acceptReport(RUNNER, later);
    assert.equal(cancelled.status, Task.CANCELLED);

    assert.throws(() => running().acceptReport(RUNNER, LATER), RuleViolation);
    assert.throws(() => running().acceptReport('다른 러너', NOW), RuleViolation);
  });

  test('임대가 끝나면 대기열로, 세 번째면 실패로', () => {
    const task = queued();
    for (let i = 1; i < Task.MAX_ATTEMPTS; i++) {
      task.lease(RUNNER, AGENT, NOW);
      task.expire(LATER);
      assert.equal(task.status, Task.QUEUED);
      assert.equal(task.leasedBy, null);
    }
    task.lease(RUNNER, AGENT, NOW);
    task.expire(LATER);
    assert.equal(task.status, Task.FAILED);
    assert.equal(task.leaseUntil, null);
  });

  test('돌려준 일은 시도로 세지 않는다', () => {
    const task = running();
    task.release(RUNNER, '모델 한도', NOW);
    assert.equal(task.status, Task.QUEUED);
    assert.equal(task.attempts, 0);
    assert.equal(task.leasedBy, null);
  });

  test('고쳐 달라고 하면 말과 함께 대기열로 돌아가고 시도를 새로 센다', () => {
    const task = waiting();
    task.returnForRevision('제목을 바꿔 주세요', 'post', POST, 2);
    assert.equal(task.targetKind, 'post');
    assert.equal(task.targetId, POST);
    assert.equal(task.baseVersion, 2);
    assert.equal(task.status, Task.QUEUED);
    assert.equal(task.revisionNote, '제목을 바꿔 주세요');
    assert.equal(task.attempts, 0);
    assert.equal(task.leaseUntil, null);
  });

  test('실행 결과는 두 번 와도 같다', () => {
    const task = waiting();
    task.resume();
    task.concludeExecution(true, null, NOW);
    assert.equal(task.status, Task.DONE);
    task.concludeExecution(false, '늦게 온 실패', NOW);
    assert.equal(task.status, Task.DONE);
  });

  test('모르는 기록 종류는 거절한다', () => {
    assert.throws(() => running().log('chat', '', 0, NOW), RuleViolation);
  });

  test('바뀐 열만 기억한다', () => {
    const task = Task.restore(
      'task-1',
      3,
      'space',
      AGENT,
      'draft_post',
      '글',
      '',
      {},
      null,
      null,
      null,
      null,
      Task.RUNNING,
      0,
      new Date(NOW.getTime() + 1000),
      RUNNER,
      1,
      null,
      null,
      null,
      0,
      null,
      0,
      NOW,
      null,
    );
    assert.equal(task.changed, false);
    task.waitFor(NOW);
    assert.deepEqual(Object.keys(task.changes), ['status', 'wait_reason']);
    assert.equal(task.waitReason, Task.WAIT_APPROVAL);
  });

  test('kind로 스킬을 고른다', () => {
    assert.equal(queued().skill, 'cairn-write');
    const unknown = Task.open('s', null, 'other', 't', '', {}, null, null, null, 0, 'r', null, NOW);
    assert.equal(unknown.skill, null);
  });
});

describe('작업 토큰', () => {
  const box = SecretBox.fromEnv({ CAIRN_SECRET_KEY: SecretBox.newKey() });

  test('에이전트의 권한만 담는다', () => {
    const actor = running().actorFor(AGENT, ['write']);
    const token = actor.seal(box, Task.RUN_TOKEN_SECONDS);
    assert.equal(AgentActor.isToken(token), true);
    const opened = AgentActor.open(box, token);
    assert.equal(opened?.agentId, AGENT);
    assert.equal(opened?.taskId, actor.taskId);
    assert.equal(opened?.can('write'), true);
    assert.equal(opened?.can('run'), false);
    assert.equal(opened?.can('read_all'), false);
  });

  test('다른 서버 키나 고친 토큰은 풀리지 않는다', () => {
    const token = running().actorFor(AGENT, []).seal(box, 60);
    const other = SecretBox.fromEnv({ CAIRN_SECRET_KEY: SecretBox.newKey() });
    assert.equal(AgentActor.open(other, token), null);
    assert.equal(AgentActor.open(box, `${token.slice(0, -2)}xx`), null);
  });

  test('다른 용도로 싼 값은 작업 토큰이 아니다', () => {
    const forged = `cairn_run_${box.pack(JSON.stringify({ agentId: AGENT, scopes: ['write'] }), 60)}`;
    assert.equal(AgentActor.open(box, forged), null);
  });

  test('서버 키가 없으면 풀지 않는다', () => {
    assert.equal(AgentActor.open(SecretBox.fromEnv({}), 'cairn_run_abc'), null);
  });
});

describe('위임', () => {
  /** 팀장과 바로 아래 팀원 둘(글쓰기, 정리), 팀 밖의 에이전트 하나 */
  function org() {
    const make = (name: string, scopes: string[]) =>
      Agent.open('space', name, '', 'claude', scopes, [], null, null, null, NOW);
    const lead = make('팀장', ['read_public']);
    const writer = make('글쓰기', ['read_public', 'write']);
    const tidier = make('정리', ['tidy', 'read_all']);
    const outsider = make('남', ['write']);
    const all = [lead, writer, tidier, outsider];
    writer.reportTo(lead.id, all);
    tidier.reportTo(lead.id, all);
    return { lead, writer, tidier, outsider };
  }

  function leadTask(lead: Agent): Task {
    const task = Task.open(
      'space',
      lead.id,
      'general',
      '이번 달 글',
      '',
      {},
      null,
      null,
      null,
      7,
      randomUUID(),
      'goal-1',
      NOW,
    );
    task.lease(RUNNER, lead.id, NOW);
    return task;
  }

  const order = (task: Task, lead: Agent, worker: Agent | null, kind = 'general') =>
    task.subtask(
      lead,
      worker,
      randomUUID(),
      kind,
      '조사',
      '자료를 모아 주세요',
      null,
      null,
      null,
      NOW,
    );

  test('바로 아래 팀원에게 맡기면 목표 · 우선순위 · 깊이를 물려받은 대기 작업이 생긴다', () => {
    const { lead, writer } = org();
    const parent = leadTask(lead);
    parent.assertCanDelegate(lead.id, 1, 0, NOW);
    const child = order(parent, lead, writer, 'draft_post');
    assert.equal(child.status, Task.QUEUED);
    assert.equal(child.agentId, writer.id);
    assert.equal(child.parentId, parent.id);
    assert.equal(child.depth, 1);
    assert.equal(child.goalId, 'goal-1');
    assert.equal(child.priority, 7);
    assert.match(String(child.requestId), new RegExp(`^delegate:${parent.id}:`));

    parent.waitForSubtasks(1, NOW);
    assert.equal(parent.status, Task.WAITING);
    assert.equal(parent.waitReason, Task.WAIT_SUBTASKS);
    assert.equal(parent.rounds, 1);
    assert.throws(() => parent.resume(), RuleViolation, '결재 승인으로 깨울 수 없다');
  });

  test('팀이 아니거나 없는 에이전트, 권한으로 못 하는 일, 맡길 수 없는 종류는 막는다', () => {
    const { lead, writer, tidier, outsider } = org();
    const parent = leadTask(lead);
    assert.throws(() => order(parent, lead, outsider), Forbidden);
    assert.throws(() => order(parent, lead, null), Forbidden);
    assert.throws(() => order(parent, writer, tidier), Forbidden, '팀원끼리는 맡기지 못한다');
    assert.throws(() => order(parent, lead, writer, 'tidy_session'), RuleViolation);
    assert.throws(() => order(parent, lead, writer, 'ai_test'), RuleViolation);
    assert.equal(order(parent, lead, tidier, 'tidy_session').kind, 'tidy_session');
    assert.deepEqual(Task.delegableWith(writer.scopes), ['general', 'draft_post']);
  });

  test('한도: 한 번에 5개, 작업 하나에 10개, 깊이 3, 라운드 3. 실행 중이 아니면 conflict', () => {
    const { lead } = org();
    const parent = leadTask(lead);
    assert.throws(() => parent.assertCanDelegate(lead.id, 6, 0, NOW), RuleViolation);
    assert.throws(() => parent.assertCanDelegate(lead.id, 0, 0, NOW), RuleViolation);
    assert.throws(() => parent.assertCanDelegate(lead.id, 2, 9, NOW), RuleViolation);
    parent.assertCanDelegate(lead.id, 1, 9, NOW);
    assert.throws(() => parent.assertCanDelegate('someone-else', 1, 0, NOW), Forbidden);
    assert.throws(() => parent.assertCanDelegate(lead.id, 1, 0, LATER), Conflict, '임대가 끝남');

    const deep = Task.restore(
      't',
      1,
      'space',
      lead.id,
      'general',
      't',
      '',
      {},
      null,
      null,
      null,
      null,
      Task.RUNNING,
      0,
      LATER,
      RUNNER,
      1,
      'r',
      null,
      'p',
      Task.DEPTH_MAX,
      null,
      0,
      NOW,
      null,
    );
    assert.throws(() => deep.assertCanDelegate(lead.id, 1, 0, NOW), RuleViolation);
    const tired = Task.restore(
      't',
      1,
      'space',
      lead.id,
      'general',
      't',
      '',
      {},
      null,
      null,
      null,
      null,
      Task.RUNNING,
      0,
      LATER,
      RUNNER,
      1,
      'r',
      null,
      null,
      0,
      null,
      Task.ROUNDS_MAX,
      NOW,
      null,
    );
    assert.throws(() => tired.assertCanDelegate(lead.id, 1, 0, NOW), RuleViolation);

    parent.waitForSubtasks(1, NOW);
    assert.throws(() => parent.assertCanDelegate(lead.id, 1, 0, NOW), Conflict);
  });

  test('하위 작업이 끝나면 깨어나 대기열로: 시도 횟수는 새로, 기다리는 이유는 지운다', () => {
    const { lead } = org();
    const parent = leadTask(lead);
    parent.waitForSubtasks(2, NOW);
    parent.clearChanges();
    parent.wakeAfterSubtasks(NOW);
    assert.equal(parent.status, Task.QUEUED);
    assert.equal(parent.waitReason, null);
    assert.equal(parent.attempts, 0);
    assert.equal(parent.leaseUntil, null);
    assert.equal(parent.changes.wait_reason, null);
  });

  test('결재를 기다리는 작업은 하위 작업으로 깨울 수 없고, 취소하면 기다리는 이유가 지워진다', () => {
    const task = waiting();
    assert.throws(() => task.wakeAfterSubtasks(NOW), RuleViolation);
    task.cancel(NOW);
    assert.equal(task.waitReason, null);
    assert.equal(task.settled, true);
  });
});
