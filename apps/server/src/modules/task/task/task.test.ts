import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, test } from 'node:test';
import { AgentActor, RuleViolation, SecretBox } from '../../platform';
import type { TaskRow } from '../task.tables';
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
    randomUUID(),
    { agent_id: AGENT, kind: 'draft_post', title: '글 쓰기', instruction: '지시' },
    NOW,
  );
}

/** 러너가 받는 일의 모양 */
const job = (task: Task) => task.jobView(null, SecretBox.fromEnv({})).toJSON();

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
    assert.equal(task.unsaved.status, Task.QUEUED);
    task.lease(RUNNER, AGENT, NOW);
    assert.equal(task.unsaved.status, Task.RUNNING);
    assert.equal(task.unsaved.attempts, 1);
    assert.equal(task.unsaved.leased_by, RUNNER);
    task.waitFor(NOW);
    assert.equal(task.unsaved.status, Task.WAITING);
    task.resume();
    assert.equal(task.unsaved.status, Task.RUNNING);
    assert.equal(task.unsaved.lease_until, null);
    task.finish({ ok: true }, NOW);
    assert.equal(task.unsaved.status, Task.DONE);
    assert.equal(task.unsaved.finished_at, NOW);
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

  test('상태에는 set이 없다: 행은 메서드로만 바뀐다', () => {
    const task = queued() as unknown as { row: Partial<TaskRow> };
    assert.throws(() => {
      task.row = { status: Task.DONE };
    }, TypeError);
  });

  test('임대를 쥔 러너가 살아 있는 임대로만 끝낼 수 있다', () => {
    assert.throws(() => running().submit('다른 러너', Task.DONE, {}, null, NOW), RuleViolation);
    assert.throws(() => running().submit(RUNNER, Task.DONE, {}, null, LATER), RuleViolation);
    const task = running();
    task.submit(RUNNER, Task.DONE, { ok: true }, null, NOW);
    assert.equal(task.unsaved.status, Task.DONE);
    const failed = running();
    failed.submit(RUNNER, Task.FAILED, {}, '실패 이유', NOW);
    assert.equal(failed.unsaved.status, Task.FAILED);
    assert.deepEqual(failed.unsaved.result, { error: '실패 이유' });
  });

  test('진행 보고는 임대를 늘린다. 취소·결재 대기는 기록만 받는다', () => {
    const task = running();
    const later = new Date(NOW.getTime() + 60_000);
    task.acceptReport(RUNNER, later);
    assert.equal(task.unsaved.lease_until?.getTime(), later.getTime() + Task.LEASE_MS);

    const held = waiting();
    const lease = held.unsaved.lease_until;
    held.acceptReport(RUNNER, later);
    assert.equal(held.unsaved.lease_until, lease);

    const cancelled = running();
    cancelled.cancel(NOW);
    cancelled.acceptReport(RUNNER, later);
    assert.equal(cancelled.unsaved.status, Task.CANCELLED);

    assert.throws(() => running().acceptReport(RUNNER, LATER), RuleViolation);
    assert.throws(() => running().acceptReport('다른 러너', NOW), RuleViolation);
  });

  test('임대가 끝나면 대기열로, 세 번째면 실패로', () => {
    const task = queued();
    for (let i = 1; i < Task.MAX_ATTEMPTS; i++) {
      task.lease(RUNNER, AGENT, NOW);
      task.expire(LATER);
      assert.equal(task.unsaved.status, Task.QUEUED);
      assert.equal(task.unsaved.leased_by, null);
    }
    task.lease(RUNNER, AGENT, NOW);
    task.expire(LATER);
    assert.equal(task.unsaved.status, Task.FAILED);
    assert.equal(task.unsaved.lease_until, null);
  });

  test('돌려준 일은 시도로 세지 않는다', () => {
    const task = running();
    task.release(RUNNER, '모델 한도', NOW);
    assert.equal(task.unsaved.status, Task.QUEUED);
    assert.equal(task.unsaved.attempts, 0);
    assert.equal(task.unsaved.leased_by, null);
  });

  test('고쳐 달라고 하면 말과 함께 대기열로 돌아가고 시도를 새로 센다', () => {
    const task = waiting();
    task.returnForRevision('제목을 바꿔 주세요', 'post', POST, 2);
    assert.equal(task.unsaved.target_kind, 'post');
    assert.equal(task.unsaved.target_id, POST);
    assert.equal(task.unsaved.base_version, 2);
    assert.equal(task.unsaved.status, Task.QUEUED);
    assert.equal(job(task).revision_note, '제목을 바꿔 주세요');
    assert.equal(task.unsaved.attempts, 0);
    assert.equal(task.unsaved.lease_until, null);
  });

  test('실행 결과는 두 번 와도 같다', () => {
    const task = waiting();
    task.resume();
    task.concludeExecution(true, null, NOW);
    assert.equal(task.unsaved.status, Task.DONE);
    task.concludeExecution(false, '늦게 온 실패', NOW);
    assert.equal(task.unsaved.status, Task.DONE);
  });

  test('모르는 기록 종류는 거절한다', () => {
    assert.throws(() => running().log('chat', '', 0, NOW), RuleViolation);
  });

  test('바뀐 열만 기억한다', () => {
    const task = Task.restore({
      id: 'task-1',
      version: 3,
      space_id: 'space',
      agent_id: AGENT,
      kind: 'draft_post',
      status: Task.RUNNING,
      lease_until: new Date(NOW.getTime() + 1000),
      leased_by: RUNNER,
      attempts: 1,
    } as TaskRow);
    assert.deepEqual(task.unsaved, {});
    task.waitFor(NOW);
    assert.deepEqual(Object.keys(task.unsaved), ['status']);
  });

  test('kind로 스킬을 고른다', () => {
    assert.equal(job(queued()).skill, 'cairn-write');
    const unknown = Task.open('s', 'r', { kind: 'other', title: 't' }, NOW);
    assert.equal(job(unknown).skill, null);
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
