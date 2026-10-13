import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { DeviceActor, OwnerActor, RuleViolation } from '../../platform';
import { SensitivePolicy } from './sensitive.policy';
import { Session, SessionReceipt } from './session';
import { SessionNote } from './session-note';

// 세션 노트·민감정보 지우기·판 쌓기 규칙 (DB 없이).
// 시험용 비밀값은 실행할 때 이어 붙여 만든다: 소스에 그 모양이 그대로 있으면 GitHub의 비밀값 검사가 push를 막는다.

const SPACE = '0192d2a0-0000-7000-8000-000000000001';
const device = new DeviceActor(SPACE, '0192d2a0-0000-7000-8000-000000000002', new Set(['upload']));
const policy = new SensitivePolicy();
const github = `gh${'p_'}${'A1b2C3d4'.repeat(5)}`;

function note(did: string, extra: Partial<Record<string, string>> = {}): SessionNote {
  return SessionNote.write(
    '세션 저장 만들기',
    ['cairn'],
    new Map(Object.entries({ did, ...extra })),
  );
}

describe('SessionNote', () => {
  test('제목과 칸 하나는 있어야 한다', () => {
    assert.throws(() => SessionNote.write('  ', [], new Map([['did', '일']])), RuleViolation);
    assert.throws(() => SessionNote.write('제목', [], new Map([['did', '  ']])), RuleViolation);
  });

  test('본문 md는 내용이 있는 칸만 고정 소제목으로', () => {
    const md = note('저장 API를 만들었다', { quotes: '> 판은 추가만' }).toMarkdown();
    assert.equal(md, '## 한 일\n\n저장 API를 만들었다\n\n## 인용\n\n> 판은 추가만\n');
  });

  test('해시: 앞뒤 공백·태그 순서 겹침이 달라도 같은 내용이면 같고, 한 글자라도 다르면 다르다', () => {
    const a = SessionNote.write('제목', ['a', 'b', 'a'], new Map([['did', '일 ']]));
    const b = SessionNote.write(' 제목', ['a', 'b'], new Map([['did', '일']]));
    assert.equal(a.hash, b.hash);
    assert.notEqual(a.hash, note('일.').hash);
    assert.deepEqual(Object.keys(a.sectionHashes()).sort(), [
      'blocked',
      'decisions',
      'did',
      'extra',
      'quotes',
      'tags',
      'title',
    ]);
  });
});

describe('SensitivePolicy', () => {
  const aws = `AK${'IA'}${'ABCDEFGH'.repeat(2)}`;
  const slack = `xo${'xb-'}1234567890-abcdefghij`;
  const anthropic = `sk-${'ant-'}${'x'.repeat(30)}`;
  const openai = `sk-${'proj-'}${'y'.repeat(30)}`;
  const jwt = `ey${'J'}hbGciOiJIUzI1NiJ9.ey${'J'}zdWIiOiIxMjM0In0.c2lnbmF0dXJlLXZhbHVl`;
  const pem = `-----BEGIN ${'OPENSSH'} PRIVATE KEY-----\nb3BlbnNzaC1rZXk=\n-----END OPENSSH PRIVATE KEY-----`;

  test('토큰·키·개인 키·JWT는 지우고, 무엇을 어느 칸에서 지웠는지만 남긴다', () => {
    const dirty = note(`푸시 토큰 ${github} 로 확인`, {
      quotes: `AWS ${aws}\nslack ${slack}\n${anthropic} ${openai}\n${jwt}\n${pem}`,
    });
    const clean = policy.clean(dirty);
    const all = JSON.stringify(clean.toJSON());
    for (const secret of [github, aws, slack, anthropic, openai, jwt, 'b3BlbnNzaC1rZXk='])
      assert.equal(all.includes(secret), false, `${secret.slice(0, 6)}…이 남았다`);
    assert.equal(clean.section('did'), '푸시 토큰 [지움: GitHub 토큰] 로 확인');
    assert.deepEqual(
      clean.redactions.map((r) => `${r.section}:${r.label}`),
      [
        'did:GitHub 토큰',
        'quotes:개인 키',
        'quotes:AWS 키',
        'quotes:Slack 토큰',
        'quotes:Anthropic API 키',
        'quotes:OpenAI API 키',
        'quotes:JWT',
      ],
    );
    assert.deepEqual(clean.redactions[0]?.toJSON(), {
      kind: 'secret',
      section: 'did',
      label: 'GitHub 토큰',
    });
  });

  test('password=값은 값만 지우고, 코드 속 타입·환경 변수 이름은 그대로 둔다', () => {
    const clean = policy.clean(
      note(
        [
          'DB_PASSWORD 설정: password=hunter2025',
          'api_key: "abcdefghijklmnopqrstuv"',
          'password: string;',
          'token: process.env.CAIRN_TOKEN',
        ].join('\n'),
      ),
    );
    assert.equal(
      clean.section('did'),
      [
        'DB_PASSWORD 설정: password=[지움: 비밀번호·키 값]',
        'api_key: "[지움: 비밀번호·키 값]"',
        'password: string;',
        'token: process.env.CAIRN_TOKEN',
      ].join('\n'),
    );
  });

  test('지운 노트를 다시 지워도 그대로 (이미 지운 자리는 건드리지 않는다)', () => {
    const once = policy.clean(note(`password=hunter2025 ${github}`));
    const twice = policy.clean(once);
    assert.equal(twice.section('did'), once.section('did'));
  });
});

describe('Session', () => {
  test('기기에서만 올릴 수 있고, 도구 이름은 영문 소문자·숫자·-', () => {
    const owner = new OwnerActor(SPACE, '0192d2a0-0000-7000-8000-000000000003');
    assert.throws(() => Session.open(owner, 'claude-code', 'abc', null, null), RuleViolation);
    assert.throws(() => Session.open(device, 'Claude Code', 'abc', null, null), RuleViolation);
  });

  test('새 내용이면 판이 쌓이고, 이미 있는 내용이면 판을 만들지 않는다. 새 세션은 늘 비공개', () => {
    const session = Session.open(device, 'claude-code', 'conv-1', 'cairn', null);
    assert.equal(session.visibility, Session.PRIVATE);
    const now = new Date('2026-10-10T10:00:00Z');
    const first = session.receive(note('하나'), device, now);
    assert.deepEqual([first.status, first.seq], [SessionReceipt.SAVED, 1]);
    const firstId = session.headRevisionId;
    const second = session.receive(note('둘'), device, now);
    assert.deepEqual([second.status, second.seq], [SessionReceipt.SAVED, 2]);
    assert.deepEqual(session.addedRevision?.parentIds, [firstId]);
    const again = session.receive(note('하나'), device, now);
    assert.deepEqual([again.status, again.seq], [SessionReceipt.UNCHANGED, 1]);
    assert.equal(session.revisionCount, 2);
    assert.deepEqual(
      session.pullEvents().map((e) => [e.name, e.data.seq]),
      [
        ['vault.session.saved', 1],
        ['vault.session.saved', 2],
      ],
    );
  });

  test('남겨 둔 결과를 되살리면 duplicate', () => {
    const saved = SessionReceipt.saved('s-1', 3, policy.clean(note(`${github}`)).redactions);
    const replay = SessionReceipt.replay(JSON.parse(JSON.stringify(saved)));
    assert.equal(replay.status, SessionReceipt.DUPLICATE);
    assert.deepEqual(JSON.parse(JSON.stringify(replay.warnings)), [
      { kind: 'secret', section: 'did', label: 'GitHub 토큰' },
    ]);
  });
});
