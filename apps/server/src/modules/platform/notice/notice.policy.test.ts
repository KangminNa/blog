import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { NoticePolicy, type PendingNotice } from './notice.policy';
import { NoticeKind } from './notice-kind';
import { NoticeSettings } from './notice-settings';

// 알림을 언제 푸시로 보낼지 (DB 없이): 경로 · 등급 · 하루 지남 · 조용한 시간 · 묶음 시각.

const SEOUL = 'Asia/Seoul';
const KINDS = [
  new NoticeKind('approval', '결재 요청', NoticeKind.IMMEDIATE),
  new NoticeKind('session', '세션 들어옴', NoticeKind.DIGEST),
  new NoticeKind('skip', '스케줄 한도', NoticeKind.LOG),
];
const at = (iso: string) => new Date(iso);
let seq = 0;
const notice = (kind: string, severity: string, created: string, title = kind): PendingNotice => ({
  id: `n${++seq}`,
  kind,
  severity,
  title,
  body: null,
  link: `/admin/${kind}`,
  created_at: at(created),
});

function settings(more: Record<string, unknown> = {}): NoticeSettings {
  const s = NoticeSettings.absent('space');
  s.configure(
    {
      digest: 'hourly',
      digest_minute: 540,
      quiet_start: null,
      quiet_end: null,
      time_zone: SEOUL,
      routes: {},
      ...more,
    },
    KINDS.map((k) => k.kind),
    at('2026-11-11T00:00:00Z'),
  );
  return s;
}

const policy = new NoticePolicy();

describe('NoticePolicy', () => {
  test('즉시는 바로 하나씩, 기록만과 경로가 푸시가 아닌 것은 보내지 않고 다룬 것으로', () => {
    const now = at('2026-11-11T03:10:00Z'); // 12:10 KST
    const a = notice('approval', 'immediate', '2026-11-11T03:09:00Z', '결재를 기다려요');
    const s = notice('skip', 'log', '2026-11-11T03:09:00Z');
    const plan = policy.decide([a, s], settings(), KINDS, now);
    assert.deepEqual(
      plan.messages.map((m) => [m.title, m.link]),
      [['결재를 기다려요', '/admin/approval']],
    );
    assert.deepEqual([...plan.handled].sort(), [a.id, s.id].sort());
    const center = policy.decide([a], settings({ routes: { approval: 'center' } }), KINDS, now);
    assert.deepEqual([center.messages.length, center.handled], [0, [a.id]]);
  });

  test('하루 지난 알림은 보내지 않는다. 즉시가 셋을 넘으면 하나로 묶는다', () => {
    const now = at('2026-11-11T03:10:00Z');
    const old = notice('approval', 'immediate', '2026-11-10T03:00:00Z');
    assert.deepEqual(policy.decide([old], settings(), KINDS, now).messages, []);
    const many = [1, 2, 3, 4].map((i) =>
      notice('approval', 'immediate', '2026-11-11T03:00:00Z', `결재 ${i}`),
    );
    const plan = policy.decide(many, settings(), KINDS, now);
    assert.equal(plan.messages.length, 1);
    assert.equal(plan.messages[0]?.title, '알림 4개');
    assert.match(String(plan.messages[0]?.body), /결재 1 · 결재 2/);
    assert.equal(plan.handled.length, 4);
  });

  test('묶음: 한 시간마다면 가장 오래된 것 뒤로 정각이 지났을 때 하나로', () => {
    const d1 = notice('session', 'digest', '2026-11-11T03:05:00Z', '세션 1'); // 12:05 KST
    const d2 = notice('session', 'digest', '2026-11-11T03:20:00Z', '세션 2');
    const early = policy.decide([d1, d2], settings(), KINDS, at('2026-11-11T03:40:00Z'));
    assert.deepEqual(
      [early.messages.length, early.handled.length],
      [0, 0],
      '13:00 전에는 기다린다',
    );
    const due = policy.decide([d1, d2], settings(), KINDS, at('2026-11-11T04:00:30Z'));
    assert.deepEqual(
      due.messages.map((m) => m.title),
      ['알림 2개'],
    );
    assert.equal(due.handled.length, 2);
  });

  test('묶음: 하루 한 번이면 정한 시각(서울 09:00)이 지났을 때', () => {
    const daily = settings({ digest: 'daily', digest_minute: 540 });
    const d = notice('session', 'digest', '2026-11-11T01:00:00Z', '세션'); // 10:00 KST
    assert.equal(
      policy.decide([d], daily, KINDS, at('2026-11-11T14:00:00Z')).messages.length,
      0,
      '같은 날 23:00',
    );
    const next = policy.decide([d], daily, KINDS, at('2026-11-12T00:01:00Z')); // 다음 날 09:01
    assert.deepEqual(
      next.messages.map((m) => m.title),
      ['세션'],
      '하나면 그 알림 그대로',
    );
  });

  test('조용한 시간(자정을 넘어도)에는 미루고, 끝나면 보낸다. 보내지 않을 것은 그때도 다룬다', () => {
    const quiet = settings({ quiet_start: 23 * 60, quiet_end: 7 * 60 });
    const a = notice('approval', 'immediate', '2026-11-11T15:00:00Z'); // 00:00 KST
    const s = notice('skip', 'log', '2026-11-11T15:00:00Z');
    const night = policy.decide([a, s], quiet, KINDS, at('2026-11-11T17:00:00Z')); // 02:00 KST
    assert.deepEqual([night.messages.length, night.handled], [0, [s.id]]);
    assert.equal(policy.quiet(quiet, at('2026-11-11T14:30:00Z')), true, '23:30');
    assert.equal(policy.quiet(quiet, at('2026-11-11T22:00:00Z')), false, '07:00 정각은 끝');
    const morning = policy.decide([a], quiet, KINDS, at('2026-11-11T22:05:00Z'));
    assert.equal(morning.messages.length, 1);
  });
});
