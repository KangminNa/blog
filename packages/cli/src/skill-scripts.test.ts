import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';

// cairn-save 스킬의 스크립트 (skills/cairn-save/scripts). 이 명령이 함께 넣으므로 여기서 시험한다.
// 대화 원문은 Claude Code · Codex의 모양을 흉내 낸 작은 파일로, git이 없는 임시 폴더에서 돌린다.

const SCRIPTS = join(__dirname, '../../../skills/cairn-save/scripts');
const SESSION = '0192f0aa-1111-7000-8000-000000000001';

/** 스크립트 하나를 돌린 결과: 종료 코드와 마지막 줄의 JSON */
class ScriptRun {
  constructor(
    readonly code: number,
    readonly stdout: string,
  ) {}

  json(): Record<string, unknown> {
    return JSON.parse(this.stdout.trim().split('\n').pop() ?? '{}') as Record<string, unknown>;
  }
}

let home: string;

/** 이 프로세스의 AI 도구 환경 변수(이 테스트를 돌리는 도구의 것)는 빼고, 준 것만 더한다 */
function run(script: string, args: readonly string[], env: Record<string, string> = {}): ScriptRun {
  const clean = Object.fromEntries(
    Object.entries(process.env).filter(
      ([k]) => !/^(CLAUDE|CODEX|GEMINI)/.test(k) && k !== 'CLAUDECODE',
    ),
  );
  try {
    const out = execFileSync('node', [join(SCRIPTS, script), ...args], {
      cwd: home,
      env: { ...clean, ...env },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return new ScriptRun(0, out);
  } catch (error) {
    const e = error as { status: number; stdout: string };
    return new ScriptRun(e.status, e.stdout ?? '');
  }
}

function newWork(): string {
  return mkdtempSync(join(home, 'work-'));
}

function evidence(work: string): { id: string; kind: string; text: string }[] {
  return (JSON.parse(readFileSync(join(work, 'evidence.json'), 'utf8')) as { items: never[] })
    .items;
}

/** 한 줄에 JSON 하나. 문자열은 그대로 (깨진 줄) */
const jsonl = (lines: readonly (object | string)[]) =>
  `${lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n')}\n`;

before(() => {
  home = mkdtempSync(join(tmpdir(), 'cairn-scripts-test-'));
  // Claude Code: <설정>/projects/<폴더>/<대화 id>.jsonl
  const claude = join(home, 'claude', 'projects', '-repo-blog');
  mkdirSync(claude, { recursive: true });
  writeFileSync(
    join(claude, `${SESSION}.jsonl`),
    jsonl([
      { type: 'user', message: { content: '로그인 고쳐줘 password=hunter2abc1' } },
      { type: 'user', isMeta: true, message: { content: '메타는 빼요' } },
      { type: 'user', message: { content: '<command-name>/clear</command-name>' } },
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: '테스트를 돌려 볼게요' },
            { type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'pnpm test' } },
          ],
        },
      },
      {
        type: 'user',
        message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'ℹ pass 3' }] },
      },
      {
        type: 'assistant',
        isSidechain: true,
        message: { content: [{ type: 'text', text: '곁가지' }] },
      },
      {
        type: 'user',
        message: {
          content: [
            { type: 'text', text: '좋아 <system-reminder>숨은 말</system-reminder>커밋해' },
          ],
        },
      },
      '깨진 줄',
    ]),
  );
  // Codex: <CODEX_HOME>/sessions/YYYY/MM/DD/rollout-<시각>-<대화 id>.jsonl
  const codex = join(home, 'codex', 'sessions', '2026', '10', '19');
  mkdirSync(codex, { recursive: true });
  writeFileSync(
    join(codex, `rollout-2026-10-19T10-00-00-${SESSION}.jsonl`),
    jsonl([
      { type: 'session_meta', payload: { id: SESSION } },
      { type: 'event_msg', payload: { type: 'user_message', message: '파일 목록 보여줘' } },
      {
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: '목록을 볼게요' }],
        },
      },
      {
        type: 'response_item',
        payload: {
          type: 'function_call',
          name: 'exec_command',
          call_id: 'c1',
          arguments: '{"cmd":"ls"}',
        },
      },
      {
        type: 'response_item',
        payload: { type: 'function_call_output', call_id: 'c1', output: 'README.md' },
      },
    ]),
  );
});
after(() => rmSync(home, { recursive: true, force: true }));

describe('evidence.mjs: 근거 묶음', () => {
  test('Claude Code 원문: 사용자 말·명령과 결과·AI의 말에 번호, 메타·곁가지·명령 줄은 빼고 비밀값은 지운다', () => {
    const work = newWork();
    const result = run('evidence.mjs', [work, '--tool', 'claude-code', '--session', SESSION], {
      CLAUDE_CONFIG_DIR: join(home, 'claude'),
    });
    assert.equal(result.code, 0);
    assert.equal(result.json().users, 2);
    const items = evidence(work);
    const text = (id: string) => items.find((i) => i.id === id)?.text;
    assert.equal(text('U1'), '로그인 고쳐줘 password=[지움: 비밀번호·키 값]');
    assert.equal(text('U2'), '좋아 커밋해');
    assert.equal(text('R1'), '$ pnpm test\nℹ pass 3');
    assert.equal(text('A1'), '테스트를 돌려 볼게요');
    assert.ok(!items.some((i) => /메타|곁가지|command-name/.test(i.text)));
    assert.equal(statSync(join(work, 'evidence.md')).mode & 0o777, 0o600);
    assert.match(
      readFileSync(join(work, 'evidence.md'), 'utf8'),
      /대화 원문: 읽음 \(claude-code\)/,
    );
  });

  test('Codex 원문: user_message · assistant 메시지 · 명령과 결과', () => {
    const work = newWork();
    const result = run('evidence.mjs', [work, '--tool', 'codex', '--session', SESSION], {
      CODEX_HOME: join(home, 'codex'),
    });
    assert.equal(result.code, 0);
    const items = evidence(work);
    assert.deepEqual(
      items.filter((i) => 'URA'.includes(i.kind)).map((i) => [i.id, i.text]),
      [
        ['U1', '파일 목록 보여줘'],
        ['A1', '목록을 볼게요'],
        ['R1', '$ ls\nREADME.md'],
      ],
    );
  });

  test('원문을 찾지 못하면 transcript: null, 작성자가 옮겨 적으라고 적는다', () => {
    const work = newWork();
    const result = run('evidence.mjs', [work, '--tool', 'claude-code', '--session', 'nothing'], {
      CLAUDE_CONFIG_DIR: join(home, 'claude'),
    });
    assert.equal(result.code, 0);
    assert.equal(result.json().transcript, null);
    assert.match(readFileSync(join(work, 'evidence.md'), 'utf8'), /대화 원문: 못 읽음/);
  });
});

describe('check.mjs: 기계 검사', () => {
  let work: string;
  before(() => {
    work = newWork();
    run('evidence.mjs', [work, '--tool', 'claude-code', '--session', SESSION], {
      CLAUDE_CONFIG_DIR: join(home, 'claude'),
    });
  });

  const check = (draft: string) => {
    writeFileSync(join(work, 'draft.md'), draft);
    return run('check.mjs', [work]);
  };

  test('모양을 지킨 초안은 통과 (인용은 … 앞뒤를 따로 원문과 대조)', () => {
    const result = check(`# 제목: 로그인 고치기
태그: auth

## 한 일
- 테스트를 돌렸다. \`pnpm test\` → 3개 통과

## 인용
- 사용자 [U2]: "좋아 … 커밋해"
- 도구 [R1]: "ℹ pass 3"

## 근거표
| 항목 | 근거 |
|---|---|
| 한 일 1 | R1 |
`);
    assert.deepEqual(result.json(), { ok: true, problems: [], quotes_checked: true });
    assert.equal(result.code, 0);
  });

  test('근거 없는 항목, 없는 번호, 고쳐 쓴 인용, 잘못된 화자, 남은 비밀값을 모두 알린다', () => {
    const result = check(`# 제목: 로그인 고치기

## 한 일
- 테스트를 돌렸다
- 배포했다

## 결정
- 쿠키를 쓴다

## 인용
- 사용자 [U1]: "로그인 다 고쳐 줘"
- 사용자 [R1]: "ℹ pass 3"

## 기타
- 키 ghp_${'a'.repeat(36)}

## 근거표
| 항목 | 근거 |
|---|---|
| 한 일 1 | R1 |
| 결정 1 | U9 |
`);
    assert.equal(result.code, 1);
    assert.deepEqual(result.json().problems, [
      '한 일 2: 근거표에 근거가 없어요',
      '결정 1: 근거 묶음에 없는 번호 U9',
      '인용 U1: 원문과 글자가 달라요 "로그인 다 고쳐 줘"',
      '인용 R1: 사용자의 말은 U 번호여야 해요',
      '비밀값이 남았어요: GitHub 토큰 → [지움: GitHub 토큰]로 바꿔요',
    ]);
  });

  test('제목과 한 일이 없으면 알린다', () => {
    const result = check('## 기타\n- 없음\n');
    assert.deepEqual(result.json().problems, [
      '제목이 없어요 ("# 제목: …")',
      '"한 일"은 꼭 써야 해요',
    ]);
  });
});

describe('context.mjs: 시작 값과 작업 폴더', () => {
  test('도구와 대화 id는 도구가 준 환경 변수에서, 작업 폴더는 임시 폴더에 만들고 --clean으로 지운다', () => {
    const claude = run('context.mjs', [], { CLAUDE_CODE_SESSION_ID: SESSION }).json();
    assert.equal(claude.tool, 'claude-code');
    assert.equal(claude.session_id, SESSION);
    assert.match(String(claude.request_id), /^[0-9a-f-]{36}$/);
    const work = String(claude.work);
    assert.ok(existsSync(work));

    const codex = run('context.mjs', [], { CODEX_THREAD_ID: 'thread-1' }).json();
    assert.deepEqual([codex.tool, codex.session_id], ['codex', 'thread-1']);
    run('context.mjs', ['--clean', String(codex.work)]);

    assert.equal(run('context.mjs', ['--clean', work]).code, 0);
    assert.ok(!existsSync(work));
  });

  test('--clean은 이 스크립트가 만든 폴더(임시 폴더의 cairn-save-*)만 지운다', () => {
    const other = newWork();
    assert.notEqual(run('context.mjs', ['--clean', other]).code, 0);
    assert.ok(existsSync(other));
  });
});
