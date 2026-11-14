// Cairn 기기의 열쇠와 서버 부르기 (cairn connect가 ~/.cairn/bin에 넣는다). Node 내장 모듈만 쓴다.
//
//   ~/.cairn/credentials.json   기기마다 키 하나: { news: {…}, collect: {…} }
//                               { site, mcp, token_endpoint, client_id, device, access_token, refresh_token, expires_at, dead? }
//                               0600. cairn connect가 쓰고, 갱신하면 여기서 다시 쓴다
//   ~/.cairn/credentials.lock   갱신하는 동안만 있다. 기기가 여럿이어도 하나다: 한 파일을 함께 고쳐 쓰므로 갱신은 한 번에 하나
//                               (훅과 상태 줄이 같은 갱신 토큰을 두 번 내밀면 서버가 기기를 끊는다)
//
// 갱신 요청을 도중에 끊으면 서버는 갱신 토큰을 이미 바꿨는데 새 토큰을 잃는다 (다음 갱신이 재사용으로 보여 기기가 끊긴다).
// 그래서 2초 안에 끝나야 하는 곳(소식 훅 · 상태 줄)은 끝나기 10분 전부터 갱신을 따로 띄우고(cairn-refresh.mjs),
// 그동안 아직 살아 있는 토큰을 쓴다. 기다릴 수 있는 곳(세션 저장의 떼어 낸 일꾼)은 patient로 불러 잠금이 풀리기를
// 기다렸다 직접 갱신한다: 가끔 끝나는 세션은 늘 토큰이 끝나 있어서 다음으로 미루면 영영 올리지 못한다.
// 토큰은 어디에도 찍지 않는다. 실패는 던지고, 부르는 쪽이 조용히 넘어간다.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 이만큼 남으면 미리 갱신한다 (access 토큰은 1시간) */
const EARLY_MS = 10 * 60_000;
/** 갱신 요청을 기다리는 시간. 잠금이 낡았다고 보는 시간보다 짧아야 한다 */
const REFRESH_MS = 15_000;
/** 이보다 오래된 잠금은 갱신하다 죽은 프로세스가 남긴 것이다 */
const STALE_LOCK_MS = 30_000;
/** patient: 다른 프로세스의 갱신이 끝나기를 기다리는 시간 */
const LOCK_WAIT_MS = STALE_LOCK_MS + 5_000;

/** ~/.cairn (HOME을 따른다) */
export function cairnHome() {
  return join(homedir(), '.cairn');
}

const credentialsFile = () => join(cairnHome(), 'credentials.json');
const lockFile = () => join(cairnHome(), 'credentials.lock');

/** 서버가 기기를 받아 주지 않음 (없거나 끊겼거나 갱신 토큰이 죽음). cairn connect로 다시 만든다 */
export class Disconnected extends Error {}

/** 파일 하나를 통째로 바꾼다 (반쯤 쓴 파일을 다른 프로세스가 읽지 않게) */
export function replaceFile(path, text, mode = 0o600) {
  const temp = `${path}.${randomBytes(6).toString('hex')}.tmp`;
  writeFileSync(temp, text, { mode });
  chmodSync(temp, mode);
  renameSync(temp, path);
}

/** 모든 열쇠. 없거나 깨졌으면 빈 것 */
function readCredentials() {
  try {
    const raw = JSON.parse(readFileSync(credentialsFile(), 'utf8'));
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

/** 기기 하나(news · collect)의 열쇠. 없으면 null */
export function deviceCredential(key) {
  const device = readCredentials()[key];
  return device && typeof device.access_token === 'string' && typeof device.mcp === 'string'
    ? device
    : null;
}

/** 잠금을 잡은 채로만 부른다 (다른 기기의 키를 옛 값으로 덮지 않게) */
function saveDevice(key, device) {
  mkdirSync(cairnHome(), { recursive: true, mode: 0o700 });
  replaceFile(
    credentialsFile(),
    `${JSON.stringify({ ...readCredentials(), [key]: device }, null, 2)}\n`,
  );
}

/** 다른 프로세스가 갱신 중인가 (낡지 않은 잠금이 있다) */
function locked() {
  try {
    return Date.now() - statSync(lockFile()).mtimeMs < STALE_LOCK_MS;
  } catch {
    return false;
  }
}

/** 잠금을 잡는다. 다른 프로세스가 갱신 중이면 false */
function lock() {
  try {
    closeSync(openSync(lockFile(), 'wx', 0o600));
    return true;
  } catch {
    try {
      if (locked()) return false;
      unlinkSync(lockFile());
      closeSync(openSync(lockFile(), 'wx', 0o600));
      return true;
    } catch {
      return false;
    }
  }
}

function unlock() {
  try {
    unlinkSync(lockFile());
  } catch {}
}

const expiring = (device) => Date.parse(device.expires_at ?? '') - Date.now() <= EARLY_MS;

/** 갱신을 따로 띄운다 (이 프로세스가 끝나도 끝까지 간다). 이미 누가 갱신 중이면 띄우지 않는다 */
function startRefresh(key, force) {
  if (locked()) return;
  const script = join(dirname(fileURLToPath(import.meta.url)), 'cairn-refresh.mjs');
  const child = spawn(process.execPath, [script, key, ...(force ? ['force'] : [])], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.on('error', () => {});
  child.unref();
}

/** 쓸 수 있는 access 토큰. 끝나 가면 갱신을 띄우고, 아직 살아 있으면 그대로 쓴다. 이미 끝났으면 이번에는 실패 */
function accessToken(key, device) {
  if (device.dead) throw new Disconnected('기기가 끊겼어요');
  const left = Date.parse(device.expires_at ?? '') - Date.now();
  if (left > EARLY_MS) return device.access_token;
  startRefresh(key, false);
  if (left > 0) return device.access_token;
  throw new Error('토큰이 끝나 새로 받는 중이에요');
}

/** 잠금을 잡고 파일을 다시 읽어, need(기기)면 갱신한다. 다른 프로세스가 갱신 중이면 false */
async function refreshLocked(key, need) {
  if (!lock()) return false;
  try {
    const device = deviceCredential(key);
    if (device && !device.dead && need(device))
      await refresh(key, device, AbortSignal.timeout(REFRESH_MS));
    return true;
  } finally {
    unlock();
  }
}

/** 따로 띄운 갱신 (cairn-refresh.mjs). force: 서버가 토큰을 받지 않았을 때 (끝나지 않았어도) */
export async function refreshNow(key, force) {
  await refreshLocked(key, (device) => force || expiring(device));
}

/**
 * patient: 잠금이 풀리기를 기다려 직접 갱신하고 새 열쇠를 돌려준다.
 * rejected는 서버가 받지 않은 토큰: 그새 다른 프로세스가 바꿨으면 다시 갱신하지 않는다
 */
async function freshDevice(key, rejected) {
  const until = Date.now() + LOCK_WAIT_MS;
  const need = (device) => device.access_token === rejected || expiring(device);
  while (!(await refreshLocked(key, need))) {
    if (Date.now() > until) throw new Error('다른 갱신이 끝나지 않아요');
    await new Promise((done) => setTimeout(done, 200));
  }
  const device = deviceCredential(key);
  if (!device || device.dead) throw new Disconnected('기기가 끊겼어요');
  return device;
}

async function refresh(key, device, signal) {
  const res = await fetch(device.token_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: device.refresh_token ?? '',
      client_id: device.client_id ?? '',
    }),
    signal,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || typeof body.access_token !== 'string') {
    // 갱신 토큰이 죽었다 (만료 · 끊김 · 재사용 감지). 다시 내밀지 않게 적어 둔다
    if (body.error === 'invalid_grant') {
      saveDevice(key, { ...device, dead: true });
      throw new Disconnected('기기가 끊겼어요');
    }
    throw new Error(`토큰을 갱신하지 못했어요 (${res.status})`);
  }
  saveDevice(key, {
    ...device,
    access_token: body.access_token,
    refresh_token: body.refresh_token ?? device.refresh_token,
    expires_at: new Date(Date.now() + Number(body.expires_in ?? 3600) * 1000).toISOString(),
  });
}

/** MCP 도구 하나를 부른다 (JSON-RPC over HTTP). 도구의 거절은 { refused: { code, message } } */
async function callOnce(device, tool, args, signal) {
  const res = await fetch(device.mcp, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${device.access_token}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: tool, arguments: args },
    }),
    signal,
  });
  if (res.status === 401) return { unauthorized: true };
  if (!res.ok) throw new Error(`서버가 ${res.status}로 답했어요`);
  const text = await res.text();
  // 스트림(SSE)으로 오면 마지막 data 줄이 답이다
  const json = text.trimStart().startsWith('{')
    ? text
    : (text
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .pop()
        ?.slice(5) ?? '{}');
  const result = JSON.parse(json).result ?? {};
  if (result.isError) {
    let refused = { code: 'error', message: '' };
    try {
      refused = JSON.parse(result.content?.[0]?.text ?? '{}');
    } catch {}
    return { refused };
  }
  return { value: result.structuredContent ?? {} };
}

/**
 * 기기(key)로 도구를 부른다. 서두르는 곳은 토큰이 거절되면 갱신을 띄우고 이번에는 실패한다.
 * patient면 끝나 가는 토큰은 먼저 갱신하고, 거절되면 갱신한 뒤 한 번 더 부른다
 */
export async function callTool(key, tool, args, signal, patient = false) {
  let device = deviceCredential(key);
  if (!device) throw new Disconnected('기기가 없어요');
  if (!patient) {
    const reply = await callOnce(
      { ...device, access_token: accessToken(key, device) },
      tool,
      args,
      signal,
    );
    if (!reply.unauthorized) return reply;
    startRefresh(key, true);
    throw new Error('서버가 기기의 토큰을 받지 않아요');
  }
  if (device.dead) throw new Disconnected('기기가 끊겼어요');
  if (expiring(device))
    try {
      device = await freshDevice(key, null);
    } catch (error) {
      // 갱신만 못 했고 토큰이 아직 살아 있으면 그것으로 부른다
      if (error instanceof Disconnected || Date.parse(device.expires_at ?? '') <= Date.now())
        throw error;
    }
  const reply = await callOnce(device, tool, args, signal);
  if (!reply.unauthorized) return reply;
  device = await freshDevice(key, device.access_token);
  const again = await callOnce(device, tool, args, signal);
  if (again.unauthorized) throw new Error('서버가 기기의 토큰을 받지 않아요');
  return again;
}
