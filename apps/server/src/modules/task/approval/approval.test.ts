import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { Forbidden, RuleViolation } from '../../platform';
import { Agent } from '../agent/agent';
import { Task } from '../task/task';
import { Approval } from './approval';

// 결재의 상태 기계: 결정은 한 번뿐이고, 승인은 동작·대상·승인자를 이벤트로 남긴다. DB 없이 돈다.

const NOW = new Date('2026-11-01T00:00:00Z');
const OWNER = 'owner-1';
const TARGET = '00000000-0000-7000-8000-000000000001';

function agent(actions: readonly string[] = ['blog.post.publish']): Agent {
  return Agent.open('space', '글쓰기', '', 'claude', ['write'], actions, null, null, null, NOW);
}

function runningTask(who: Agent): Task {
  const task = Task.open(
    'space',
    who.id,
    'draft_post',
    '글',
    '',
    {},
    null,
    null,
    null,
    0,
    'request',
    NOW,
  );
  task.lease('runner', who.id, NOW);
  return task;
}

function pending(): { approval: Approval; task: Task } {
  const who = agent();
  const task = runningTask(who);
  const approval = Approval.request(
    task,
    who,
    'blog.post.publish',
    'post',
    TARGET,
    3,
    '공개해 주세요',
    NOW,
  );
  return { approval, task };
}

describe('결재 상태', () => {
  test('올리면 작업이 결재를 기다린다', () => {
    const { approval, task } = pending();
    assert.equal(approval.status, Approval.PENDING);
    assert.equal(task.status, Task.WAITING);
    assert.equal(task.addedLog.at(-1)?.body, '결재 요청: blog.post.publish (공개해 주세요)');
  });

  test('맡기지 않은 동작은 올릴 수 없다', () => {
    const who = agent();
    const task = runningTask(who);
    assert.throws(
      () => Approval.request(task, who, 'sns.post.send', 'post', TARGET, 1, null, NOW),
      Forbidden,
    );
    assert.equal(task.status, Task.RUNNING);
  });

  test('승인은 동작·대상·승인자를 이벤트로 남기고 작업은 실행을 기다린다', () => {
    const { approval, task } = pending();
    approval.pullEvents();
    approval.approve(OWNER, null, NOW);
    approval.applyTo(task, NOW);
    assert.equal(approval.status, Approval.APPROVED);
    assert.equal(task.status, Task.RUNNING);
    assert.equal(task.leaseUntil, null);
    const [event] = approval.pullEvents();
    assert.equal(event?.name, 'task.approval.granted');
    assert.deepEqual(event?.data, {
      approvalId: approval.id,
      taskId: task.id,
      agentId: approval.agentId,
      action: 'blog.post.publish',
      targetKind: 'post',
      targetId: TARGET,
      targetVersion: 3,
      decidedBy: OWNER,
      note: '공개해 주세요',
    });
  });

  test('고쳐 달라고 하면 작업이 말과 함께 대기열로 돌아간다', () => {
    const { approval, task } = pending();
    approval.requestRevision(OWNER, '제목을 바꿔 주세요', NOW);
    approval.applyTo(task, NOW);
    assert.equal(approval.status, Approval.REVISION_REQUESTED);
    assert.equal(task.status, Task.QUEUED);
    assert.equal(task.revisionNote, '제목을 바꿔 주세요');
  });

  test('고칠 말 없이 고쳐 달라고 할 수 없다', () => {
    assert.throws(() => pending().approval.requestRevision(OWNER, null, NOW), RuleViolation);
    assert.throws(() => pending().approval.requestRevision(OWNER, '  ', NOW), RuleViolation);
  });

  test('거절하면 작업이 멈춘다', () => {
    const { approval, task } = pending();
    approval.reject(OWNER, '안 해요', NOW);
    approval.applyTo(task, NOW);
    assert.equal(approval.status, Approval.REJECTED);
    assert.equal(task.status, Task.CANCELLED);
  });

  test('결정은 한 번뿐이다', () => {
    const { approval } = pending();
    approval.approve(OWNER, null, NOW);
    assert.throws(() => approval.approve(OWNER, null, NOW), RuleViolation);
    assert.throws(() => approval.reject(OWNER, null, NOW), RuleViolation);
    assert.throws(() => approval.requestRevision(OWNER, '다시', NOW), RuleViolation);
    assert.throws(() => approval.cancel(), RuleViolation);
  });

  test('모르는 결정은 거절한다', () => {
    assert.throws(() => pending().approval.decide('maybe', OWNER, null, NOW), RuleViolation);
  });

  test('한도 올리기 결재는 작업에 묶이지 않고 대상이 에이전트다', () => {
    const who = agent();
    const approval = Approval.raiseLimit(who, 120, NOW);
    assert.equal(approval.taskId, null);
    assert.equal(approval.targetKind, 'agent');
    assert.equal(approval.targetId, who.id);
    assert.equal(approval.raisesLimit, false);
    approval.approve(OWNER, null, NOW);
    assert.equal(approval.raisesLimit, true);
  });
});

describe('에이전트', () => {
  test('러너의 권한은 줄 수 없다', () => {
    assert.throws(() => {
      agent().scopes = ['run'];
    }, RuleViolation);
  });

  test('한도 올리기는 에이전트가 맡을 수 있는 동작이 아니다', () => {
    assert.throws(() => agent([Approval.RAISE_LIMIT]), RuleViolation);
    assert.throws(() => agent(['publish']), RuleViolation);
  });

  test('한도를 넘기면 한 번만 잡히고, 올리면 두 배가 되어 다시 움직인다', () => {
    const who = Agent.open('space', '글쓰기', '', 'claude', [], [], 100, null, null, NOW);
    assert.equal(who.overLimit(100), false);
    assert.equal(who.overLimit(101), true);
    who.pause();
    assert.equal(who.overLimit(101), false);
    who.raiseLimit();
    assert.equal(who.paused, false);
    assert.equal(who.monthlyLimit, 200);
  });

  test('한도가 없으면 넘길 수 없다', () => {
    assert.equal(agent().overLimit(Number.MAX_SAFE_INTEGER), false);
  });

  test('바뀐 열만 기억한다', () => {
    const who = Agent.restore(
      'agent-1',
      2,
      'space',
      '글쓰기',
      '',
      'claude',
      [],
      [],
      null,
      null,
      null,
      Agent.ACTIVE,
      NOW,
    );
    who.name = '정리';
    assert.deepEqual(who.changes, { name: '정리' });
    who.pause();
    assert.deepEqual(who.changes, { name: '정리', status: Agent.PAUSED });
  });
});
