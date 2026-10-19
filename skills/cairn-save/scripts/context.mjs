// cairn-save가 처음에 부르는 스크립트. 이번 저장에 쓸 값을 JSON 한 줄로 알려 주고, 작업 폴더를 만든다.
//
//   node context.mjs                작업 시작
//   node context.mjs --clean <work> 작업 폴더 지우기 (근거 묶음에 대화 원문이 있어서 끝나면 지운다)
//
// 알려 주는 값
//   work        작업 폴더 (근거 묶음 · 초안 · 검토 결과). 이 컴퓨터의 임시 폴더, 나만 읽을 수 있게
//   tool        지금 도는 AI 도구 (claude-code · codex · gemini-cli, 모르면 null)
//   session_id  대화 id (도구가 알려 줄 때만, 아니면 null → check_session이 만들어 준다)
//   project     작업한 프로젝트 이름 (git 저장소 이름, 없으면 폴더 이름)
//   site        올릴 블로그 주소 (cairn connect가 이 스킬 폴더의 .cairn.json에 적어 둔 값)
//   request_id  예비 UUID (check_session이 준 값을 먼저 쓴다)
// Node 내장 모듈만 쓴다.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const skillDir = dirname(dirname(fileURLToPath(import.meta.url)));
const env = process.env;

if (process.argv[2] === '--clean') {
  const work = resolve(process.argv[3] ?? '');
  // 이 스크립트가 만든 폴더만 지운다
  if (!basename(work).startsWith('cairn-save-') || dirname(work) !== resolve(tmpdir()))
    throw new Error(`cairn-save의 작업 폴더가 아니에요: ${work}`);
  rmSync(work, { recursive: true, force: true });
  console.log(JSON.stringify({ cleaned: work }));
  process.exit(0);
}

function git(args) {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

function project() {
  const remote = git(['remote', 'get-url', 'origin']);
  const fromRemote = remote
    .replace(/\.git$/, '')
    .split(/[/:]/)
    .pop();
  if (fromRemote) return fromRemote;
  return basename(git(['rev-parse', '--show-toplevel']) || process.cwd());
}

function marker() {
  try {
    return JSON.parse(readFileSync(join(skillDir, '.cairn.json'), 'utf8'));
  } catch {
    return {};
  }
}

/** 지금 도는 도구와 대화 id. 도구가 환경 변수로 알려 줄 때만 */
function tool() {
  if (env.CLAUDE_CODE_SESSION_ID || env.CLAUDECODE)
    return ['claude-code', env.CLAUDE_CODE_SESSION_ID || null];
  if (env.CODEX_THREAD_ID || env.CODEX_SANDBOX || env.CODEX_HOME)
    return ['codex', env.CODEX_THREAD_ID || null];
  if (env.GEMINI_CLI) return ['gemini-cli', null];
  return [marker().tool ?? null, null];
}

const [name, sessionId] = tool();
const work = mkdtempSync(join(tmpdir(), 'cairn-save-'));
console.log(
  JSON.stringify({
    work,
    tool: name,
    session_id: sessionId,
    project: project(),
    site: marker().site ?? null,
    request_id: randomUUID(),
  }),
);
