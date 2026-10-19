// 근거 묶음 만들기: 이 대화의 원문 파일과 git에서, 노트의 주장을 확인할 원자료를 모은다.
//
//   node evidence.mjs <work> [--tool claude-code|codex] [--session <대화 id>]
//
// 결과: <work>/evidence.md (사람·검토자가 읽는 것), <work>/evidence.json (check.mjs가 읽는 것)
//   U 사용자 메시지 원문 · R 실행한 명령과 결과 앞부분 · A AI가 한 말 · F 바뀐 파일 · C 커밋
// 비밀값은 [지움: 종류]로 바꿔 둔다 (교차 검토 때 다른 AI에게도 보이므로). 이 컴퓨터를 떠나지 않는다.
// 대화 원문 파일의 모양은 도구가 공개한 약속이 아니다. 읽지 못하면 transcript: null로 알리고 git 부분만 만든다.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { redact } from './secrets.mjs';

const LIMIT = { user: 4000, result: 1500, ai: 1500, total: 120_000 };
const args = process.argv.slice(2);
const work = args[0];
const option = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
if (!work || !existsSync(work)) throw new Error('작업 폴더를 주세요: node evidence.mjs <work>');
const env = process.env;
const toolName =
  option('--tool') ??
  (env.CLAUDE_CODE_SESSION_ID || env.CLAUDECODE
    ? 'claude-code'
    : env.CODEX_THREAD_ID
      ? 'codex'
      : null);
const session = option('--session') ?? env.CLAUDE_CODE_SESSION_ID ?? env.CODEX_THREAD_ID ?? null;

const clip = (text, max) => (text.length > max ? `${text.slice(0, max)} …(줄임)` : text);
const clean = (text) => redact(text).text;

/** 디렉터리 아래에서 이름이 맞는 파일 하나 (깊이 4까지) */
function find(dir, test, depth = 0) {
  if (!existsSync(dir) || depth > 4) return null;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = find(path, test, depth + 1);
      if (found) return found;
    } else if (test(entry.name)) return path;
  }
  return null;
}

/** Claude Code: ~/.claude/projects/<폴더>/<대화 id>.jsonl */
function claudeCode(id) {
  const root = join(env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects');
  const file = find(root, (name) => name === `${id}.jsonl`);
  if (!file) return null;
  const items = [];
  const pending = new Map();
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (o.isSidechain || o.isMeta) continue;
    const content = o.message?.content;
    if (o.type === 'user' && typeof content === 'string') items.push(['U', content]);
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (o.type === 'user' && block.type === 'text') items.push(['U', block.text]);
      if (o.type === 'assistant' && block.type === 'text') items.push(['A', block.text]);
      if (block.type === 'tool_use' && block.name === 'Bash')
        pending.set(block.id, String(block.input?.command ?? ''));
      if (block.type === 'tool_result' && pending.has(block.tool_use_id)) {
        const output = Array.isArray(block.content)
          ? block.content.map((c) => c.text ?? '').join('\n')
          : String(block.content ?? '');
        items.push(['R', `$ ${pending.get(block.tool_use_id)}\n${output}`]);
      }
    }
  }
  return { file, items };
}

/** Codex: $CODEX_HOME/sessions/YYYY/MM/DD/rollout-<시각>-<대화 id>.jsonl */
function codex(id) {
  const root = join(env.CODEX_HOME || join(homedir(), '.codex'), 'sessions');
  const file = find(root, (name) => name.startsWith('rollout-') && name.endsWith(`${id}.jsonl`));
  if (!file) return null;
  const items = [];
  const pending = new Map();
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    const p = o.payload ?? {};
    if (o.type === 'event_msg' && p.type === 'user_message')
      items.push(['U', String(p.message ?? '')]);
    if (o.type !== 'response_item') continue;
    if (p.type === 'message' && p.role === 'assistant')
      items.push(['A', (p.content ?? []).map((c) => c.text ?? '').join('\n')]);
    if (p.type === 'function_call') {
      let call = {};
      try {
        call = JSON.parse(p.arguments ?? '{}');
      } catch {}
      const command = Array.isArray(call.command)
        ? call.command.join(' ')
        : (call.cmd ?? call.command ?? '');
      pending.set(p.call_id, String(command));
    }
    if (p.type === 'function_call_output' && pending.has(p.call_id))
      items.push(['R', `$ ${pending.get(p.call_id)}\n${String(p.output ?? '')}`]);
  }
  return { file, items };
}

function git(gitArgs) {
  try {
    return execFileSync('git', gitArgs, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

// 1) 대화 원문
const transcript = !session ? null : toolName === 'codex' ? codex(session) : claudeCode(session);
const raw = (transcript?.items ?? [])
  .map(([kind, text]) => [
    kind,
    text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim(),
  ])
  .filter(([kind, text]) => text && !(kind === 'U' && text.startsWith('<')));

// 2) git: 바뀐 파일(커밋 안 한 것 포함)과 최근 커밋
const files = [
  ...new Set(
    [git(['diff', '--name-only', 'HEAD']), git(['ls-files', '--others', '--exclude-standard'])]
      .join('\n')
      .split('\n')
      .filter(Boolean),
  ),
].map((f) => `${f}${existsSync(f) ? '' : ' (지움)'}`);
const since = transcript ? new Date(statSync(transcript.file).birthtime).toISOString() : null;
const commits = git([
  'log',
  '--oneline',
  '-n',
  '30',
  ...(since ? [`--since=${since}`] : ['-n', '10']),
])
  .split('\n')
  .filter(Boolean);

// 번호 매기기 (종류마다 1부터). 너무 크면 오래된 결과부터 줄인다
const counters = { U: 0, R: 0, A: 0 };
const numbered = raw.map(([kind, text]) => {
  counters[kind] += 1;
  const max = kind === 'U' ? LIMIT.user : kind === 'R' ? LIMIT.result : LIMIT.ai;
  return { id: `${kind}${counters[kind]}`, kind, text: clean(clip(text, max)) };
});
// 오래된 것부터 줄인다: 결과·AI의 말 먼저, 그래도 크면 사용자 메시지도 (앞부분은 남긴다)
const size = () => numbered.reduce((sum, i) => sum + i.text.length, 0);
for (const kinds of [['R', 'A'], ['U']])
  for (const item of numbered) {
    if (size() <= LIMIT.total) break;
    if (kinds.includes(item.kind) && item.text.length > 300)
      item.text = `${item.text.slice(0, 300)} …(줄임 · 크기 제한)`;
  }
const evidence = [
  ...numbered,
  ...files.map((f, i) => ({ id: `F${i + 1}`, kind: 'F', text: f })),
  ...commits.map((c, i) => ({ id: `C${i + 1}`, kind: 'C', text: clean(c) })),
];

const TITLE = {
  U: '사용자 메시지',
  R: '실행한 명령과 결과',
  A: 'AI가 한 말 (사실의 근거가 아님)',
  F: '바뀐 파일',
  C: '커밋',
};
const md = [
  '# 근거 묶음',
  transcript
    ? `대화 원문: 읽음 (${toolName})`
    : '대화 원문: 못 읽음 — 작성자가 사용자 메시지와 결과를 아래에 옮겨 적는다',
  '',
  ...Object.entries(TITLE).flatMap(([kind, title]) => {
    const list = evidence.filter((e) => e.kind === kind);
    return list.length ? [`## ${title}`, '', ...list.map((e) => `### ${e.id}\n\n${e.text}\n`)] : [];
  }),
].join('\n');
writeFileSync(join(work, 'evidence.md'), md, { mode: 0o600 });
writeFileSync(
  join(work, 'evidence.json'),
  JSON.stringify({ tool: toolName, transcript: Boolean(transcript), items: evidence }),
  {
    mode: 0o600,
  },
);
console.log(
  JSON.stringify({
    evidence: join(work, 'evidence.md'),
    transcript: transcript ? transcript.file : null,
    users: counters.U,
    results: counters.R,
    ai: counters.A,
    files: files.length,
    commits: commits.length,
  }),
);
