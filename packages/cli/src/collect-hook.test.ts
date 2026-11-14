import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, before, beforeEach, describe, test } from 'node:test';
import { CairnHome } from './cairn-home';
import { FakeCairn } from './testing/fake-cairn';

// 세션 저장 스크립트 (packages/cli/hooks/cairn-collect.mjs). cairn connect처럼 ~/.cairn/bin에 넣고(비밀값 무늬 secrets.mjs 포함)
// 가짜 블로그에 붙여 프로세스로 돌린다. HOME을 임시 폴더로 바꿔 ~/.cairn이 그 안에 생긴다. 세션의 폴더는 git 원격이 있는 임시 저장소.

const TOKEN = 'cairn_at_collecttest';
const SESSION = '0192f0aa-2222-7000-8000-000000000001';

class Run {
  constructor(
    readonly code: number | null,
    /** 표준 출력 + 오류 출력 */
    readonly output: string,
    readonly ms: number,
  ) {}
}

let blog: FakeCairn;
let home: string;
let repo: string;

const cairn = () => join(home, '.cairn');
const outbox = () => join(cairn(), 'outbox');
const outboxFiles = () => (existsSync(outbox()) ? readdirSync(outbox()) : []);
const credentials = () => JSON.parse(readFileSync(join(cairn(), 'credentials.json'), 'utf8'));

/** 스크립트를 부른다 (hook은 표준 입력에 Claude Code의 JSON) */
function run(args: readonly string[], stdin = ''): Promise<Run> {
  const started = Date.now();
  return new Promise((done) => {
    const child = spawn(process.execPath, [join(cairn(), 'bin', 'cairn-collect.mjs'), ...args], {
      env: { PATH: process.env.PATH, HOME: home },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (chunk) => {
      out += chunk;
    });
    child.stderr.on('data', (chunk) => {
      out += chunk;
    });
    child.on('close', (code) => done(new Run(code, out, Date.now() - started)));
    child.stdin.end(stdin);
  });
}

/** 떼어 낸 일꾼을 직접 돌린다 (끝날 때까지 기다린다) */
const work = (session = SESSION, transcript = transcriptFile(session), cwd: string | null = repo) =>
  run(['work', JSON.stringify({ session_id: session, transcript_path: transcript, cwd })]);

/** Claude Code의 대화 원문: 한 줄에 JSON 하나. 문자열은 그대로 (깨진 줄) */
function writeTranscript(session: string, lines: readonly (object | string)[]): string {
  const file = transcriptFile(session);
  mkdirSync(join(home, 'transcripts'), { recursive: true });
  writeFileSync(
    file,
    `${lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n')}\n`,
  );
  return file;
}
const transcriptFile = (session: string) => join(home, 'transcripts', `${session}.jsonl`);

/** 사람이 한 번 말하고 AI가 한 번 답한 짧은 세션 */
const short = (session: string, said: string, answer = '답했어요') =>
  writeTranscript(session, [
    { type: 'user', timestamp: '2026-11-14T09:00:00.000Z', message: { content: said } },
    { type: 'assistant', message: { content: [{ type: 'text', text: answer }] } },
  ]);

function writeCredentials(collect: Record<string, unknown> = {}): void {
  mkdirSync(cairn(), { recursive: true });
  const device = (name: string, token: string) => ({
    site: blog.origin,
    mcp: `${blog.origin}/mcp`,
    token_endpoint: `${blog.origin}/oauth/token`,
    client_id: `cairn_${name}`,
    device: `mac · ${name}`,
    access_token: token,
    refresh_token: `cairn_rt_${name}test`,
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
  });
  writeFileSync(
    join(cairn(), 'credentials.json'),
    JSON.stringify({
      news: device('news', 'cairn_at_newstest'),
      collect: { ...device('collect', TOKEN), ...collect },
    }),
    { mode: 0o600 },
  );
}

/** 따로 도는 것(떼어 낸 일꾼)이 끝나기를 기다린다 */
async function until(what: string, ready: () => boolean): Promise<void> {
  const deadline = Date.now() + 8_000;
  while (!ready()) {
    assert.ok(Date.now() < deadline, `기다렸지만 오지 않음: ${what}`);
    await new Promise((done) => setTimeout(done, 50));
  }
}

before(async () => {
  blog = new FakeCairn();
  await blog.start();
  blog.allow(TOKEN);
});
after(() => blog.close());
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'cairn-collect-hook-'));
  repo = join(home, 'repo');
  mkdirSync(repo);
  execFileSync('git', ['init', '-q', repo]);
  execFileSync('git', ['-C', repo, 'remote', 'add', 'origin', 'git@github.com:Owner/Repo.git']);
  new CairnHome(cairn()).installScripts();
  blog.calls.length = 0;
  blog.refreshed.length = 0;
  blog.mcpStatus = 0;
  blog.refuse = () => null;
  writeCredentials();
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe('세션 → 글 (사람의 말 · AI의 말 · 도구 이름만)', () => {
  test('도구의 입력 · 결과, 생각, 메타 · 곁가지 · system-reminder · 명령 태그는 버리고 도구 이름만 남긴다', async () => {
    writeTranscript(SESSION, [
      { type: 'summary', summary: '옛 요약' },
      {
        type: 'user',
        timestamp: '2026-11-14T10:00:00.000Z',
        cwd: repo,
        message: { role: 'user', content: '로그인 고쳐줘\n자세한 건 아래' },
      },
      { type: 'user', isMeta: true, message: { content: '메타는 빼요' } },
      { type: 'user', message: { content: '<command-name>/clear</command-name>' } },
      {
        type: 'assistant',
        timestamp: '2026-11-14T10:00:05.000Z',
        message: {
          content: [
            { type: 'thinking', thinking: '속생각은 빼요' },
            { type: 'text', text: '테스트를 돌려 볼게요' },
            {
              type: 'tool_use',
              id: 'tu1',
              name: 'Bash',
              input: { command: 'cat plan-secret.txt' },
            },
          ],
        },
      },
      {
        type: 'user',
        message: {
          content: [{ type: 'tool_result', tool_use_id: 'tu1', content: '도구 결과 원문' }],
        },
      },
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', id: 'tu2', name: 'Bash', input: { command: 'ls' } },
            { type: 'tool_use', id: 'tu3', name: 'Edit', input: { old_string: '옛 코드' } },
          ],
        },
      },
      {
        type: 'user',
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 'tu2', content: [{ type: 'text', text: '결과2' }] },
          ],
        },
      },
      { type: 'assistant', message: { content: [{ type: 'text', text: '다 고쳤어요' }] } },
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
            { type: 'image', source: { type: 'base64', data: 'aGk=' } },
          ],
        },
      },
      '깨진 줄',
    ]);
    const done = await work();
    assert.deepEqual([done.code, done.output], [0, '']);
    assert.equal(blog.saves.length, 1);
    const [call] = blog.saves;
    assert.equal(call?.token, TOKEN, '세션 저장 기기의 토큰');
    const { request_id: requestId, ...args } = call?.args ?? {};
    assert.match(
      String(requestId),
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    assert.deepEqual(args, {
      tool: 'claude-code',
      source_session_id: SESSION,
      project: 'github.com/owner/repo',
      title: '로그인 고쳐줘',
      started_at: '2026-11-14T10:00:00.000Z',
      text: [
        '## 사람',
        '로그인 고쳐줘\n자세한 건 아래',
        '## AI',
        '테스트를 돌려 볼게요',
        '(도구: Bash ×2, Edit)',
        '다 고쳤어요',
        '## 사람',
        '좋아 커밋해',
      ].join('\n\n'),
    });
    assert.equal(outboxFiles().length, 0, '올렸으면 outbox에 남지 않는다');
    assert.ok(statSync(join(cairn(), 'collect.json')).mtimeMs > 0);
  });

  test('비밀값은 이 컴퓨터에서 지운다 (본문 · 제목, Cairn 러너 토큰 cairn_run_ 포함)', async () => {
    const run = `cairn_run_${'r'.repeat(32)}`;
    const github = `ghp_${'g'.repeat(36)}`;
    short(SESSION, `배포해 줘 ${run}\n토큰 ${github} password=hunter2abc1`, `${run} 확인했어요`);
    await work();
    const args = blog.saves[0]?.args ?? {};
    const text = String(args.text);
    for (const secret of [run, github, 'hunter2abc1']) assert.equal(text.includes(secret), false);
    assert.equal(text.split('[지움: Cairn 토큰]').length - 1, 2);
    assert.ok(text.includes('[지움: GitHub 토큰]'));
    assert.ok(text.includes('password=[지움: 비밀번호·키 값]'));
    assert.equal(args.title, '배포해 줘 [지움: Cairn 토큰]');
  });

  test('1,000,000자를 넘으면 앞과 뒤를 남기고 가운데를 줄인다', async () => {
    short(SESSION, `처음 말 ${'가'.repeat(1_200_000)}`, '마지막 답');
    await work();
    const text = String(blog.saves[0]?.args.text);
    assert.ok(text.length <= 1_000_000, `${text.length}자`);
    assert.ok(text.length > 999_000, `${text.length}자`);
    assert.ok(text.startsWith('## 사람\n\n처음 말 가'));
    assert.ok(text.endsWith('## AI\n\n마지막 답'));
    assert.match(text, /\n\n… \(가운데 2\d\d,\d{3}자 줄임\) …\n\n/);
    assert.equal(String(blog.saves[0]?.args.title).length, 200, '제목은 200자까지');
  });

  test('저장소의 .cairn.json이 "collect": false면 올리지 않는다 (하위 폴더에서 끝나도)', async () => {
    writeFileSync(join(repo, '.cairn.json'), JSON.stringify({ collect: false }));
    mkdirSync(join(repo, 'sub'));
    short(SESSION, '이 저장소는 올리지 않아요');
    await work(SESSION, transcriptFile(SESSION), join(repo, 'sub'));
    assert.equal(blog.calls.length, 0);
    assert.equal(outboxFiles().length, 0);

    writeFileSync(join(repo, '.cairn.json'), JSON.stringify({ collect: true }));
    await work();
    assert.equal(blog.saves.length, 1);
  });

  test('사람이 말하지 않은 세션 · 원문이 없는 세션은 올리지 않는다', async () => {
    writeTranscript(SESSION, [
      { type: 'user', isMeta: true, message: { content: '메타' } },
      { type: 'assistant', message: { content: [{ type: 'text', text: '혼잣말' }] } },
    ]);
    await work();
    await work('0192f0aa-2222-7000-8000-000000000009', join(home, 'nowhere.jsonl'));
    assert.equal(blog.calls.length, 0);
    assert.equal(outboxFiles().length, 0);
  });

  test('git 원격이 없는 폴더는 project 없이 올린다', async () => {
    const plain = join(home, 'plain');
    mkdirSync(plain);
    short(SESSION, '그냥 폴더');
    await work(SESSION, transcriptFile(SESSION), plain);
    assert.equal('project' in (blog.saves[0]?.args ?? {}), false);
  });
});

describe('못 올린 세션 (outbox)', () => {
  test('서버가 답하지 않으면 0600 파일로 남기고(토큰 없이), 다음에 오래된 것부터 다시 올린다. 같은 글이면 request_id가 같다', async () => {
    blog.mcpStatus = 503;
    short(SESSION, '첫 세션');
    const failed = await work();
    assert.deepEqual([failed.code, failed.output], [0, '']);
    const file = join(outbox(), `${SESSION}.json`);
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.equal(statSync(outbox()).mode & 0o777, 0o700);
    const kept = readFileSync(file, 'utf8');
    assert.equal(JSON.parse(kept).title, '첫 세션');
    assert.equal(kept.includes(TOKEN), false);
    assert.equal(kept.includes('cairn_rt_'), false);
    assert.equal(existsSync(join(cairn(), 'collect.json')), false);
    const firstId = blog.saves[0]?.args.request_id;

    blog.mcpStatus = 0;
    const second = '0192f0aa-2222-7000-8000-000000000002';
    short(second, '둘째 세션');
    await work(second);
    assert.deepEqual(
      blog.saves.slice(1).map((c) => c.args.title),
      ['첫 세션', '둘째 세션'],
      '남은 것부터',
    );
    assert.equal(blog.saves[1]?.args.request_id, firstId, '다시 올려도 서버에 하나');
    assert.deepEqual(outboxFiles(), []);
    const saved = JSON.parse(readFileSync(join(cairn(), 'collect.json'), 'utf8'));
    assert.equal(saved.status, 'saved');
    assert.ok(Date.now() - Date.parse(saved.saved_at) < 60_000);
  });

  test('서버가 거절한 것은 남기고 뒤로 보내, 다른 세션을 막지 않는다', async () => {
    blog.refuse = (args) =>
      args.title === '거절될 세션' ? { code: 'rule_violation', message: '안 받아요' } : null;
    const refused = '0192f0aa-2222-7000-8000-00000000000a';
    short(refused, '거절될 세션');
    await work(refused);
    assert.deepEqual(outboxFiles(), [`${refused}.json`]);
    // 거절된 것이 가장 오래됐어도 다음 것은 올라간다
    utimesSync(join(outbox(), `${refused}.json`), new Date(0), new Date(0));
    short(SESSION, '다음 세션');
    await work();
    assert.deepEqual(
      blog.saves.map((c) => c.args.title),
      ['거절될 세션', '거절될 세션', '다음 세션'],
    );
    assert.deepEqual(outboxFiles(), [`${refused}.json`]);
    assert.ok(
      statSync(join(outbox(), `${refused}.json`)).mtimeMs > Date.now() - 60_000,
      '줄의 뒤로',
    );
  });

  test('outbox가 200개로 차 있으면 올리지 못한 새 세션은 남기지 않는다 (디스크를 끝없이 채우지 않게)', async () => {
    mkdirSync(outbox(), { recursive: true });
    for (let i = 0; i < 200; i++)
      writeFileSync(join(outbox(), `old-${i}.json`), JSON.stringify({ title: `옛 ${i}` }));
    blog.mcpStatus = 503;
    short(SESSION, '찬 뒤에 끝난 세션');
    await work();
    assert.equal(outboxFiles().length, 200);
    assert.equal(outboxFiles().includes(`${SESSION}.json`), false);
  });

  test('세션 저장 기기가 없거나 끊겼으면 outbox에 두고, 기기가 생기면 다음에 올린다', async () => {
    rmSync(join(cairn(), 'credentials.json'));
    short(SESSION, '기기 없이 끝난 세션');
    await work();
    writeCredentials({ dead: true });
    const second = '0192f0aa-2222-7000-8000-000000000003';
    short(second, '끊긴 뒤 끝난 세션');
    await work(second);
    assert.equal(blog.calls.length, 0);
    assert.equal(outboxFiles().length, 2);

    writeCredentials();
    const third = '0192f0aa-2222-7000-8000-000000000004';
    short(third, '다시 연결한 뒤');
    await work(third);
    assert.equal(blog.saves.length, 3);
    assert.deepEqual(outboxFiles(), []);
  });
});

describe('토큰 (기다릴 수 있는 일꾼은 직접 갱신한다)', () => {
  test('이미 끝난 토큰이면 갱신하고 같은 실행에서 올린다. 소식 기기의 열쇠는 그대로', async () => {
    writeCredentials({
      access_token: 'cairn_at_expired',
      expires_at: new Date(Date.now() - 1000).toISOString(),
    });
    const news = credentials().news;
    short(SESSION, '하루 만에 끝난 세션');
    await work();
    assert.deepEqual(blog.refreshed, ['cairn_rt_collecttest']);
    const collect = credentials().collect;
    assert.notEqual(collect.access_token, 'cairn_at_expired');
    assert.equal(blog.saves.length, 1);
    assert.equal(blog.saves[0]?.token, collect.access_token);
    assert.deepEqual(credentials().news, news);
    assert.equal(statSync(join(cairn(), 'credentials.json')).mode & 0o777, 0o600);
    assert.equal(existsSync(join(cairn(), 'credentials.lock')), false);
  });

  test('서버가 토큰을 받지 않으면 갱신한 뒤 한 번 더 부른다', async () => {
    writeCredentials({ access_token: 'cairn_at_revoked' });
    short(SESSION, '토큰이 버려진 뒤');
    await work();
    assert.deepEqual(blog.refreshed, ['cairn_rt_collecttest']);
    assert.deepEqual(
      blog.saves.map((c) => c.token),
      [credentials().collect.access_token],
    );
    assert.deepEqual(outboxFiles(), []);
  });
});

describe('SessionEnd 훅', () => {
  test('일꾼을 떼어 띄우고 곧바로 아무것도 찍지 않고 0으로 끝난다. 일꾼이 세션을 올린다', async () => {
    short(SESSION, '훅으로 올라갈 세션');
    const input = {
      session_id: SESSION,
      transcript_path: transcriptFile(SESSION),
      cwd: repo,
      hook_event_name: 'SessionEnd',
      reason: 'prompt_input_exit',
    };
    const hooked = await run(['hook'], JSON.stringify(input));
    assert.deepEqual([hooked.code, hooked.output], [0, '']);
    assert.ok(hooked.ms < 1_500, `${hooked.ms}ms`);
    await until('일꾼이 올림', () => blog.saves.length === 1);
    assert.equal(blog.saves[0]?.args.title, '훅으로 올라갈 세션');
    await until('일꾼이 끝남', () => existsSync(join(cairn(), 'collect.json')));
  });

  test('입력이 깨졌거나 모자라면 아무것도 하지 않고 0으로 끝난다', async () => {
    for (const stdin of ['', '{ 깨진', JSON.stringify({ session_id: SESSION })]) {
      const hooked = await run(['hook'], stdin);
      assert.deepEqual([hooked.code, hooked.output], [0, '']);
    }
    await new Promise((done) => setTimeout(done, 300));
    assert.equal(blog.calls.length, 0);
  });
});
