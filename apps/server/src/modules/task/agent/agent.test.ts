import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { RuleViolation } from '../../platform';
import type { AgentRow } from '../task.tables';
import { Agent, AgentUsage } from './agent';

// 에이전트가 쉬는 규칙. DB 없이 돈다.

const NOW = new Date('2026-11-01T00:00:00Z');

function agentWith(fiveHourLimit: number | null, planStopPercent: number | null): Agent {
  return Agent.restore({
    id: 'agent-1',
    version: 1,
    space_id: 'space',
    name: '글쓰기',
    tool: 'claude',
    monthly_limit: null,
    five_hour_limit: fiveHourLimit,
    plan_stop_percent: planStopPercent,
    reports_to: null,
    status: Agent.ACTIVE,
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

describe('권한', () => {
  test('브라우저(browse)는 비공개 읽기(read_all) · 초안 작성(write)과 함께 줄 수 없다', () => {
    const agent = agentWith(null, null);
    assert.throws(() => agent.edit({ scopes: ['browse', 'read_all'] }), RuleViolation);
    // write도 임시 글 본문과 소재 메모를 연다
    assert.throws(() => agent.edit({ scopes: ['browse', 'write'] }), RuleViolation);
    agent.edit({ scopes: ['browse', 'read_public'] });
    assert.deepEqual(agent.scopes, ['read_public', 'browse']);
  });

  test('코드 작업(code)은 비공개 읽기(read_all) · 초안 작성(write)과 함께 줄 수 없다', () => {
    const agent = agentWith(null, null);
    assert.throws(() => agent.edit({ scopes: ['code', 'read_all'] }), RuleViolation);
    assert.throws(() => agent.edit({ scopes: ['code', 'write'] }), RuleViolation);
    agent.edit({ scopes: ['code', 'read_public', 'tidy'] });
    assert.deepEqual(agent.scopes, ['read_public', 'tidy', 'code']);
  });

  test('sandbox는 기기의 권한이라 에이전트에게 줄 수 없다', () => {
    assert.throws(() => agentWith(null, null).edit({ scopes: ['sandbox'] }), RuleViolation);
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
});

describe('조직도 (Agent.reportTo)', () => {
  /** 이름만 다른 에이전트. 보고 대상은 reportTo로 잇는다 */
  function named(name: string): Agent {
    return Agent.restore({
      id: `agent-${name}`,
      version: 1,
      space_id: 'space',
      name,
      tool: 'claude',
      reports_to: null,
      status: Agent.ACTIVE,
      created_at: NOW,
    } as AgentRow);
  }

  /** 지금 보고 대상 */
  const managerOf = (agent: Agent) => agent.view().toJSON().reportsTo;

  test('보고 대상이 없으면 주인에게 보고한다. 정하면 바뀐 열로 남는다', () => {
    const lead = named('팀장');
    const member = named('담당');
    const all = [lead, member];
    assert.equal(managerOf(member), null);
    member.reportTo(lead.id, all);
    assert.equal(managerOf(member), lead.id);
    assert.deepEqual(member.unsaved, { reports_to: lead.id });
    assert.equal(lead.manages(member), true);
    assert.equal(member.manages(lead), false);
    member.reportTo(null, all);
    assert.equal(managerOf(member), null, '주인에게 돌아갈 수 있다');
  });

  test('자기 자신이나 자기 팀원에게 보고하면 순환이라 막는다', () => {
    const a = named('가');
    const b = named('나');
    const c = named('다');
    const all = [a, b, c];
    b.reportTo(a.id, all);
    c.reportTo(b.id, all);
    assert.throws(() => a.reportTo(a.id, all), RuleViolation);
    assert.throws(() => a.reportTo(c.id, all), RuleViolation, '손자에게도');
    assert.equal(managerOf(a), null, '막히면 그대로');
  });

  test('없는 에이전트에게는 보고하지 못한다', () => {
    const a = named('가');
    assert.throws(() => a.reportTo('no-such', [a]), RuleViolation);
  });

  test(`깊이는 ${Agent.ORG_DEPTH_MAX}단계까지: 아래 팀째로 옮겨도 가장 깊은 팀원을 센다`, () => {
    const [a, b, c, d, e] = ['1', '2', '3', '4', '5'].map(named) as [
      Agent,
      Agent,
      Agent,
      Agent,
      Agent,
    ];
    const all = [a, b, c, d, e];
    b.reportTo(a.id, all);
    c.reportTo(b.id, all);
    d.reportTo(c.id, all);
    assert.throws(() => e.reportTo(d.id, all), RuleViolation, '5단계');

    // d 아래에 e가 있는 두 단계짜리 팀을 c 아래(4단계부터)로 옮기면 5단계가 된다
    d.reportTo(null, all);
    e.reportTo(d.id, all);
    assert.throws(() => d.reportTo(c.id, all), RuleViolation);
    d.reportTo(b.id, all);
    assert.equal(managerOf(d), b.id, '3단계 + 팀원 하나는 4단계라 된다');
  });
});
