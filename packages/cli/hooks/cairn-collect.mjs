// Claude Code 세션이 끝나면 블로그에 올린다 (cairn connect가 ~/.cairn/bin에 넣고 ~/.claude/settings.json의 SessionEnd에 건다).
//
//   node cairn-collect.mjs hook          SessionEnd 훅: 표준 입력의 JSON(session_id · transcript_path · cwd)으로
//                                        일꾼을 떼어 띄우고 곧바로 0으로 끝난다 (Claude Code를 막지 않는다)
//   node cairn-collect.mjs work <JSON>   떼어 낸 일꾼: 못 올린 세션부터 다시 올리고, 이 세션을 글로 바꿔 올린다
//
// 이 세션의 글은 사람의 말 · AI의 말 · 도구 이름만 (transcript.mjs). 이 컴퓨터에서 비밀값을 지우고(secrets.mjs, cairn-save와
// 같은 무늬) 1,000,000자를 넘으면 가운데를 줄여, 세션 저장 기기(권한 upload)의 토큰으로 MCP save_transcript를 부른다.
// 저장소 맨 위의 .cairn.json에 "collect": false가 있으면 그 저장소의 세션은 올리지 않는다.
//
//   ~/.cairn/outbox/<세션 id>.json   올릴 것 (0600). 올리기 전에 쓰고 올리면 지운다. 서버에 닿지 않거나 거절되거나
//                                    기기가 아직 없으면 남아, 다음 세션이 끝날 때 오래된 것부터 다시 올린다
//                                    (한 번에 20개 · 60초까지). 200개가 차 있으면 새 세션은 남기지 않는다
//                                    (원문은 Claude Code의 폴더에 그대로 있다. 디스크를 끝없이 채우지 않게)
//   ~/.cairn/collect.json            마지막으로 올린 때 (cairn status)
// 같은 세션 · 같은 글이면 request_id가 같아 다시 올려도 하나만 남는다.
// 아무것도 찍지 않고 기록도 남기지 않는다 (토큰 · 원문이 어디에도 새지 않게). Node 내장 모듈만 쓴다.
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  utimesSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cairnHome, callTool, replaceFile } from './device-access.mjs';
import { readHookInput } from './hook-input.mjs';
import { projectOf, remoteOf } from './news-state.mjs';
import { redact } from './secrets.mjs';
import { cut, readTranscript, titleOf, transcriptText, trimMiddle } from './transcript.mjs';

const TEXT_MAX = 1_000_000;
const TITLE_MAX = 200;
const PROJECT_MAX = 100;
/** 한 번에 다시 올리는 수와 시간 */
const RETRY_COUNT = 20;
const RETRY_MS = 60_000;
/** outbox에 남겨 두는 수 */
const OUTBOX_MAX = 200;
/** 하나를 올리는 시간 (1MB까지) */
const UPLOAD_MS = 30_000;
/** 일꾼이 무슨 일이 있어도 끝나는 시간 (멈춘 일꾼이 남지 않게. 보통은 그 전에 끝난다) */
const WORK_MS = 5 * 60_000;
const GIT_MS = 2_000;

const outboxDir = () => join(cairnHome(), 'outbox');

/** 훅: 일꾼을 떼어 띄운다. 이 프로세스가 끝나도(Claude Code가 닫혀도) 일꾼은 끝까지 간다 */
async function hook() {
  setTimeout(() => process.exit(0), 1_000).unref();
  const input = await readHookInput();
  const { session_id: id, transcript_path: transcript, cwd } = input;
  if (typeof id === 'string' && id && typeof transcript === 'string' && transcript) {
    const job = {
      session_id: id,
      transcript_path: transcript,
      cwd: typeof cwd === 'string' ? cwd : null,
    };
    const script = fileURLToPath(import.meta.url);
    const child = spawn(process.execPath, [script, 'work', JSON.stringify(job)], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.on('error', () => {});
    child.unref();
  }
  process.exit(0);
}

/** 일꾼: 남은 것부터, 그다음 이 세션 */
async function work(job) {
  setTimeout(() => process.exit(0), WORK_MS).unref();
  const reachable = await retryOutbox();
  const payload = await payloadOf(job).catch(() => null);
  if (!payload) return;
  const file = keep(payload);
  const result = reachable ? await send(file) : 'down';
  if (result !== 'sent' && waiting().length > OUTBOX_MAX) rmSync(file, { force: true });
}

/** 이 세션의 save_transcript 입력. 올리지 않을 세션이면 null (저장소가 거절 · 사람이 말하지 않음) */
async function payloadOf(job) {
  if (typeof job?.session_id !== 'string' || typeof job.transcript_path !== 'string') return null;
  const { turns, startedAt, cwd: firstCwd } = await readTranscript(job.transcript_path);
  const cwd = job.cwd || firstCwd;
  if (cwd && optedOut(cwd)) return null;
  const title = titleOf(turns);
  if (!title) return null;
  const text = trimMiddle(redact(transcriptText(turns)).text, TEXT_MAX);
  const remote = cwd ? remoteOf(cwd) : null;
  const project = remote ? projectOf(remote) : null;
  return {
    request_id: requestId(job.session_id, text),
    tool: 'claude-code',
    source_session_id: job.session_id,
    ...(project && project.length <= PROJECT_MAX ? { project } : {}),
    title: cut(redact(title).text, TITLE_MAX),
    ...(startedAt ? { started_at: startedAt } : {}),
    text,
  };
}

/** 저장소 맨 위(git이 아니면 그 폴더)의 .cairn.json이 "collect": false인가 */
function optedOut(cwd) {
  let root = cwd;
  try {
    root =
      execFileSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: GIT_MS,
      }).trim() || cwd;
  } catch {}
  try {
    return JSON.parse(readFileSync(join(root, '.cairn.json'), 'utf8'))?.collect === false;
  } catch {
    return false;
  }
}

/** 같은 세션 · 같은 글이면 같은 값 (UUID v4 모양). 다시 올려도 서버에 하나만 남는다 */
function requestId(sessionId, text) {
  const hash = createHash('sha256').update(`${sessionId}\n${text}`).digest();
  hash[6] = (hash[6] & 0x0f) | 0x40;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** 올릴 것을 outbox에 둔다 (같은 세션이면 새 글로 바꾼다) */
function keep(payload) {
  const id = payload.source_session_id;
  const name = /^[A-Za-z0-9_-]{1,128}$/.test(id)
    ? id
    : createHash('sha256').update(id).digest('hex').slice(0, 32);
  mkdirSync(outboxDir(), { recursive: true, mode: 0o700 });
  const file = join(outboxDir(), `${name}.json`);
  replaceFile(file, `${JSON.stringify(payload)}\n`);
  return file;
}

/** outbox에 남은 것, 오래된 것부터 */
function waiting() {
  let names = [];
  try {
    names = readdirSync(outboxDir()).filter((name) => name.endsWith('.json'));
  } catch {
    return [];
  }
  const files = names.flatMap((name) => {
    try {
      const file = join(outboxDir(), name);
      return [{ file, at: statSync(file).mtimeMs }];
    } catch {
      return [];
    }
  });
  return files.sort((a, b) => a.at - b.at).map((f) => f.file);
}

/** 남은 것을 다시 올린다. 서버에 닿지 않거나 기기가 없으면 멈추고 false */
async function retryOutbox() {
  const until = Date.now() + RETRY_MS;
  for (const file of waiting().slice(0, RETRY_COUNT)) {
    if (Date.now() > until) break;
    if ((await send(file)) === 'down') return false;
  }
  return true;
}

/**
 * 하나를 올린다. sent: 올리고 지움 · refused: 서버가 거절해 남김 · down: 서버에 닿지 않거나 기기가 없어 남김.
 * 남긴 것은 줄의 뒤로 보낸다 (계속 거절되는 것이 다른 세션을 막지 않게)
 */
async function send(file) {
  let payload;
  try {
    payload = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return later(file, 'refused');
  }
  let reply;
  try {
    const signal = AbortSignal.timeout(UPLOAD_MS);
    reply = await callTool('collect', 'save_transcript', payload, signal, true);
  } catch {
    return later(file, 'down');
  }
  if (!reply.value) return later(file, 'refused');
  try {
    unlinkSync(file);
  } catch {}
  const saved = { saved_at: new Date().toISOString(), status: reply.value.status ?? null };
  replaceFile(join(cairnHome(), 'collect.json'), `${JSON.stringify(saved)}\n`);
  return 'sent';
}

/** 남긴 것을 줄의 뒤로 보내고 결과를 그대로 돌려준다 */
function later(file, result) {
  try {
    const now = new Date();
    utimesSync(file, now, now);
  } catch {}
  return result;
}

const mode = process.argv[2];
if (mode === 'hook') void hook();
else if (mode === 'work') {
  let job = null;
  try {
    job = JSON.parse(process.argv[3] ?? '');
  } catch {}
  work(job).then(
    () => process.exit(0),
    () => process.exit(0),
  );
}
