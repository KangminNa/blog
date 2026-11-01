import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { RuleViolation } from '../../platform';
import { PlanUsage } from './plan-usage';

// 구독 사용률 창의 규칙. DB 없이 돈다.

const NOW = new Date('2026-11-01T00:00:00Z');
const LATER = new Date(NOW.getTime() + 60_000);
const EARLIER = new Date(NOW.getTime() - 60_000);

const seen = (window: string, percent: number, resetsAt: Date, tool = 'claude') =>
  PlanUsage.seen('space', tool, window, percent, resetsAt, 'allowed', NOW);

describe('PlanUsage', () => {
  test('초기화 시각이 지나면 유효하지 않다', () => {
    assert.equal(seen(PlanUsage.FIVE_HOUR, 72, LATER).validAt(NOW), true);
    assert.equal(seen(PlanUsage.FIVE_HOUR, 72, NOW).validAt(NOW), false);
    assert.equal(seen(PlanUsage.FIVE_HOUR, 72, EARLIER).validAt(NOW), false);
  });

  test('유효한 창 중 가장 높은 값. 지난 창과 다른 도구는 보지 않는다', () => {
    const list = [
      seen(PlanUsage.FIVE_HOUR, 72, LATER),
      seen(PlanUsage.SEVEN_DAY, 90, EARLIER),
      seen(PlanUsage.SEVEN_DAY, 99, LATER, 'codex'),
    ];
    assert.equal(PlanUsage.highest(list, 'claude', NOW), 72);
    assert.equal(PlanUsage.highest(list, 'codex', NOW), 99);
  });

  test('유효한 창이 없으면 확인 전이다', () => {
    assert.equal(PlanUsage.highest([], 'claude', NOW), null);
    const expired = [seen(PlanUsage.FIVE_HOUR, 72, EARLIER)];
    assert.equal(PlanUsage.highest(expired, 'claude', NOW), null);
  });

  test('초과 사용은 100을 넘어도 받는다. 범위 밖과 모르는 값은 거절한다', () => {
    assert.equal(seen(PlanUsage.FIVE_HOUR, 1000, LATER).percent, 1000);
    assert.throws(() => seen(PlanUsage.FIVE_HOUR, 1001, LATER), RuleViolation);
    assert.throws(() => seen(PlanUsage.FIVE_HOUR, -1, LATER), RuleViolation);
    assert.throws(() => seen('one_hour', 10, LATER), RuleViolation);
    assert.throws(
      () => PlanUsage.seen('space', 'claude', PlanUsage.FIVE_HOUR, 10, LATER, 'wat', NOW),
      RuleViolation,
    );
  });

  test('상태는 없어도 된다', () => {
    const usage = PlanUsage.seen('space', 'claude', PlanUsage.FIVE_HOUR, 10, LATER, null, NOW);
    assert.equal(usage.status, null);
  });
});
