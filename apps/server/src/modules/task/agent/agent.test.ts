import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { RuleViolation } from '../../platform';
import type { AgentRow } from '../task.tables';
import { Agent, AgentUsage } from './agent';

// 에이전트가 쉬는 규칙. DB 없이 돈다.

function agentWith(fiveHourLimit: number | null, planStopPercent: number | null): Agent {
  return Agent.restore({
    id: 'agent-1',
    version: 1,
    space_id: 'space',
    status: Agent.ACTIVE,
    five_hour_limit: fiveHourLimit,
    plan_stop_percent: planStopPercent,
  } as AgentRow);
}

describe('Agent.holds', () => {
  test('한도를 정하지 않으면 쉬지 않는다', () => {
    assert.equal(agentWith(null, null).holds(1_000_000, 1000), false);
  });

  test('5시간 토큰이 한도에 닿으면 쉰다', () => {
    const agent = agentWith(100, null);
    assert.equal(agent.holds(99, null), false);
    assert.equal(agent.holds(100, null), true);
    assert.equal(agent.holds(101, null), true);
  });

  test('구독 사용률이 정한 값에 닿으면 쉰다', () => {
    const agent = agentWith(null, 80);
    assert.equal(agent.holds(0, 79), false);
    assert.equal(agent.holds(0, 80), true);
    assert.equal(agent.holds(0, 120), true);
  });

  test('구독 사용률이 확인 전이면 토큰 한도만 본다', () => {
    const agent = agentWith(100, 1);
    assert.equal(agent.holds(99, null), false);
    assert.equal(agent.holds(100, null), true);
  });

  test('둘 중 하나만 닿아도 쉰다', () => {
    const agent = agentWith(100, 80);
    assert.equal(agent.holds(100, 10), true);
    assert.equal(agent.holds(10, 90), true);
    assert.equal(agent.holds(10, 10), false);
  });

  test('쉬어도 상태는 그대로다: 저장할 것이 없다', () => {
    const agent = agentWith(100, 80);
    agent.holds(100, 90);
    assert.equal(agent.paused, false);
    assert.deepEqual(agent.unsaved, {});
    assert.deepEqual(agent.pullEvents(), []);
  });
});

describe('AgentUsage', () => {
  test('쉬거나 멈춘 에이전트에게는 새 일을 주지 않는다', () => {
    const agent = agentWith(100, null);
    assert.equal(new AgentUsage(agent, 99, 99, null).ready, true);
    assert.equal(new AgentUsage(agent, 100, 100, null).holding, true);
    assert.equal(new AgentUsage(agent, 100, 100, null).ready, false);
    agent.pause();
    assert.equal(new AgentUsage(agent, 0, 0, null).holding, false);
    assert.equal(new AgentUsage(agent, 0, 0, null).ready, false);
  });
});

describe('한도 칸', () => {
  test('범위를 벗어나면 거절한다', () => {
    const agent = agentWith(null, null);
    assert.throws(() => agent.edit({ five_hour_limit: 0 }), RuleViolation);
    assert.throws(() => agent.edit({ plan_stop_percent: 0 }), RuleViolation);
    assert.throws(() => agent.edit({ plan_stop_percent: 101 }), RuleViolation);
  });

  test('바뀐 열만 기억하고 null로 비울 수 있다', () => {
    const agent = agentWith(100, 80);
    agent.edit({ five_hour_limit: null, plan_stop_percent: 90 });
    assert.deepEqual(agent.unsaved, { five_hour_limit: null, plan_stop_percent: 90 });
  });

  test('규칙이 없는 칸은 밖에서 바꿀 수 없다', () => {
    assert.throws(() => agentWith(null, null).edit({ status: Agent.PAUSED }));
  });
});
