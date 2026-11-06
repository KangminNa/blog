import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { RuleViolation } from '../../platform';
import { Heartbeat } from './heartbeat';
import { HeartbeatPolicy } from './heartbeat.policy';

// 하트비트의 시각 계산과 깨우기. DB 없이 돈다.

const SEOUL = 'Asia/Seoul';
const WEEKDAYS = [1, 2, 3, 4, 5];
const ALL = [1, 2, 3, 4, 5, 6, 7];
const at = (iso: string) => new Date(iso);

describe('HeartbeatPolicy.nextDaily', () => {
  test('시간대 기준 그날의 시각이 아직이면 오늘, 지났으면 내일', () => {
    // 2026-11-06(금) 08:00 KST = 2026-11-05T23:00Z
    assert.equal(
      HeartbeatPolicy.nextDaily(9 * 60, ALL, SEOUL, at('2026-11-05T23:00:00Z')).toISOString(),
      '2026-11-06T00:00:00.000Z',
    );
    // 09:00 KST 정각이면 다음 날 (지금보다 뒤의 첫 시각)
    assert.equal(
      HeartbeatPolicy.nextDaily(9 * 60, ALL, SEOUL, at('2026-11-06T00:00:00Z')).toISOString(),
      '2026-11-07T00:00:00.000Z',
    );
  });

  test('고른 요일만: 금요일 저녁이면 다음 월요일', () => {
    // 2026-11-06(금) 20:00 KST
    assert.equal(
      HeartbeatPolicy.nextDaily(
        9 * 60 + 30,
        WEEKDAYS,
        SEOUL,
        at('2026-11-06T11:00:00Z'),
      ).toISOString(),
      '2026-11-09T00:30:00.000Z',
    );
    // 일요일만
    assert.equal(
      HeartbeatPolicy.nextDaily(0, [7], SEOUL, at('2026-11-06T11:00:00Z')).toISOString(),
      '2026-11-07T15:00:00.000Z',
      '일요일 00:00 KST',
    );
  });

  test('서머타임이 있는 시간대는 그날의 오프셋으로 계산한다', () => {
    const ny = 'America/New_York';
    // 2026-11-01(일)에 EDT(-4) → EST(-5)
    assert.equal(
      HeartbeatPolicy.nextDaily(9 * 60, ALL, ny, at('2026-10-31T12:00:00Z')).toISOString(),
      '2026-10-31T13:00:00.000Z',
      '10/31 09:00 EDT',
    );
    assert.equal(
      HeartbeatPolicy.nextDaily(9 * 60, ALL, ny, at('2026-10-31T14:00:00Z')).toISOString(),
      '2026-11-01T14:00:00.000Z',
      '11/1 09:00 EST',
    );
  });
});

describe('HeartbeatPolicy.nextHourly', () => {
  test('시간대 기준 시가 N으로 나누어떨어지는 다음 정각', () => {
    // 10:20 KST → 12:00 KST (4시간마다: 0·4·8·12·16·20시)
    assert.equal(
      HeartbeatPolicy.nextHourly(4, SEOUL, at('2026-11-06T01:20:00Z')).toISOString(),
      '2026-11-06T03:00:00.000Z',
    );
    assert.equal(
      HeartbeatPolicy.nextHourly(1, SEOUL, at('2026-11-06T01:00:00Z')).toISOString(),
      '2026-11-06T02:00:00.000Z',
      '정각이면 다음 정각',
    );
    assert.equal(
      HeartbeatPolicy.nextHourly(24, SEOUL, at('2026-11-06T01:00:00Z')).toISOString(),
      '2026-11-06T15:00:00.000Z',
      '24시간마다는 자정',
    );
  });

  test('오프셋이 30분인 시간대도 그 시간대의 정각에 맞춘다', () => {
    // 인도 +05:30. 10:20 IST = 04:50Z → 11:00 IST = 05:30Z
    assert.equal(
      HeartbeatPolicy.nextHourly(1, 'Asia/Kolkata', at('2026-11-06T04:50:00Z')).toISOString(),
      '2026-11-06T05:30:00.000Z',
    );
  });

  test('알 수 없는 시간대는 거절한다', () => {
    assert.throws(() => HeartbeatPolicy.assertTimeZone('Mars/Olympus'), RuleViolation);
    HeartbeatPolicy.assertTimeZone(SEOUL);
  });
});

describe('Heartbeat', () => {
  const NOW = at('2026-11-05T23:00:00Z'); // 11/6(금) 08:00 KST

  function daily(): Heartbeat {
    const heartbeat = Heartbeat.open('space', 'agent-1', NOW);
    heartbeat.configure('daily', 9 * 60, ALL, null, SEOUL, '', null, true, NOW);
    return heartbeat;
  }

  test('처음에는 꺼져 있고, 켜면 다음 시각이 생기고, 끄면 지운다', () => {
    const heartbeat = Heartbeat.open('space', 'agent-1', NOW);
    assert.equal(heartbeat.enabled, false);
    assert.equal(heartbeat.nextRunAt?.toISOString() ?? null, null);
    heartbeat.configure('daily', 9 * 60, ALL, null, SEOUL, '확인', null, true, NOW);
    assert.equal(heartbeat.nextRunAt?.toISOString(), '2026-11-06T00:00:00.000Z');
    heartbeat.configure('hourly', null, [], 6, SEOUL, '', null, false, NOW);
    assert.equal(heartbeat.nextRunAt, null);
    assert.equal(heartbeat.atMinute, null, 'N시간마다면 시각을 지운다');
    assert.equal(heartbeat.everyHours, 6);
  });

  test('맞지 않는 설정은 거절한다', () => {
    const heartbeat = Heartbeat.open('space', 'agent-1', NOW);
    const bad = [
      () => heartbeat.configure('weekly', 0, ALL, null, SEOUL, '', null, true, NOW),
      () => heartbeat.configure('daily', null, ALL, null, SEOUL, '', null, true, NOW),
      () => heartbeat.configure('daily', 1440, ALL, null, SEOUL, '', null, true, NOW),
      () => heartbeat.configure('daily', 0, [], null, SEOUL, '', null, true, NOW),
      () => heartbeat.configure('daily', 0, [8], null, SEOUL, '', null, true, NOW),
      () => heartbeat.configure('hourly', null, ALL, 0, SEOUL, '', null, true, NOW),
      () => heartbeat.configure('hourly', null, ALL, 25, SEOUL, '', null, true, NOW),
      () => heartbeat.configure('daily', 0, ALL, null, 'Nowhere/City', '', null, true, NOW),
    ];
    for (const configure of bad) assert.throws(configure, RuleViolation);
  });

  test('때가 되면 이번 시각을 돌려주고 다음 시각으로. 여러 번 놓쳤어도 한 번만 깨운다', () => {
    const heartbeat = daily();
    assert.equal(heartbeat.dueAt(NOW), false);
    assert.throws(() => heartbeat.fire(NOW), RuleViolation);

    // 사흘 동안 꺼져 있다가 11/9 10:00 KST에 깨어남
    const late = at('2026-11-09T01:00:00Z');
    const slot = heartbeat.fire(late);
    assert.equal(slot.toISOString(), '2026-11-06T00:00:00.000Z', '놓친 첫 시각 하나');
    assert.equal(heartbeat.nextRunAt?.toISOString(), '2026-11-10T00:00:00.000Z');
    assert.equal(heartbeat.lastRunAt, late);
    assert.equal(heartbeat.dueAt(late), false);
  });

  test('작업의 request_id와 제목, 기본 지시', () => {
    const heartbeat = daily();
    const slot = at('2026-11-06T00:00:00Z');
    assert.equal(heartbeat.requestIdFor(slot), 'heartbeat:agent-1:2026-11-06T00:00:00.000Z');
    assert.match(heartbeat.titleFor(slot), /^정기 확인 \(11\. 6\. 09:00\)$/);
    assert.equal(heartbeat.taskInstruction, Heartbeat.DEFAULT_INSTRUCTION);
  });
});
