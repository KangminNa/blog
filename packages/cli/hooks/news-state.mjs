// 소식의 자리: 지금 폴더의 프로젝트(git 주소), 프로젝트마다 어디까지 보였는지(커서), 상태 줄의 캐시.
// 프로젝트(projectOf · remoteOf)는 세션 저장(cairn-collect.mjs)도 함께 쓴다.
//
//   ~/.cairn/news/<열쇠>.json         { site, project, cursor }   훅이 보인 마지막 소식의 n
//   ~/.cairn/news/<열쇠>.status.json  { at, line }                상태 줄이 마지막으로 그린 줄 (20초 동안 다시 쓴다)
// 열쇠는 블로그 주소와 프로젝트의 해시 앞 16자. 프로젝트가 없는 폴더(git 주소 없음)는 공간 전체의 소식이다.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { cairnHome, replaceFile } from './device-access.mjs';

const GIT_MS = 500;
/** 서버가 저장하고 거르는 프로젝트 모양 (ask_agent의 project와 같은 규칙) */
const PROJECT = /^[a-z0-9.-]+(\/[a-z0-9._-]+){2,}$/;
const PROJECT_MAX = 200;

/**
 * git 주소 → 프로젝트 (서버와 같은 규칙: github.com/<owner>/<repo>처럼 host/경로, 모두 소문자).
 * scp 모양(user@host:경로)과 주소 모양([scheme://][user@]host[:port]/경로)을 받고, 사용자 · 비밀번호 · 포트는 버린다.
 * 모양이 맞지 않으면 null (프로젝트로 거르지 않는다)
 */
export function projectOf(remote) {
  const text = String(remote ?? '')
    .trim()
    .replace(/^git\+/i, '');
  const scp = text.includes('://') ? null : /^[^@/\s]+@([^:/\s]+):(.+)$/.exec(text);
  const url = scp
    ? null
    : /^(?:[a-z][a-z0-9+.-]*:\/\/)?(?:[^@/]*@)?([^/:]+)(?::\d*)?\/(.+)$/i.exec(text);
  const [, host, path] = scp ?? url ?? [];
  if (!host || !path) return null;
  const project = `${host}/${path.replace(/\/+$/, '').replace(/\.git$/, '')}`.toLowerCase();
  return project.length <= PROJECT_MAX && PROJECT.test(project) ? project : null;
}

/** 그 폴더의 git 주소 (origin, 없으면 첫 원격). git이 아니면 null */
export function remoteOf(cwd) {
  const git = (args) => {
    try {
      return execFileSync('git', ['-C', cwd, ...args], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: GIT_MS,
      }).trim();
    } catch {
      return '';
    }
  };
  const origin = git(['remote', 'get-url', 'origin']);
  if (origin) return origin;
  const first = git(['remote']).split('\n')[0];
  return first ? git(['remote', 'get-url', first]) || null : null;
}

/** 블로그와 프로젝트의 자리 열쇠 */
export function stateKey(site, project) {
  return createHash('sha256')
    .update(`${site}\n${project ?? ''}`)
    .digest('hex')
    .slice(0, 16);
}

const newsDir = () => join(cairnHome(), 'news');

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function writeJson(path, value) {
  mkdirSync(newsDir(), { recursive: true, mode: 0o700 });
  replaceFile(path, `${JSON.stringify(value)}\n`);
}

/** 훅이 보인 마지막 소식의 n. 처음이면 null */
export function readCursor(key) {
  const cursor = readJson(join(newsDir(), `${key}.json`))?.cursor;
  return Number.isInteger(cursor) && cursor >= 0 ? cursor : null;
}

export function writeCursor(key, site, project, cursor) {
  if (Number.isInteger(cursor))
    writeJson(join(newsDir(), `${key}.json`), { site, project, cursor });
}

/** 상태 줄의 캐시 { at, line }. 없으면 null */
export function readStatus(key) {
  const cached = readJson(join(newsDir(), `${key}.status.json`));
  return cached && typeof cached.line === 'string' && Number.isFinite(cached.at) ? cached : null;
}

export function writeStatus(key, line) {
  writeJson(join(newsDir(), `${key}.status.json`), { at: Date.now(), line });
}

/** 훅이 소식을 보였으면 상태 줄이 다음에 바로 다시 센다 */
export function dropStatus(key) {
  try {
    unlinkSync(join(newsDir(), `${key}.status.json`));
  } catch {}
}
