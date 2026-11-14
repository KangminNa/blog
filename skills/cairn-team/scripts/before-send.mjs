// cairn-team이 ask_agent 앞에 부르는 검사. 표준 입력으로 보낼 메시지를 받아 JSON 한 줄을 찍는다.
//
//   node before-send.mjs <<'CAIRN'
//   <보낼 메시지>
//   CAIRN
//
// 알려 주는 값
//   ok       비밀값(토큰 · 키 · 비밀번호 · 개인 키) 무늬가 없으면 true. false면 0이 아닌 코드로 끝난다
//   found    찾은 비밀값의 종류와 수 [{ kind, count }]. 값 자체는 찍지 않는다
//   project  지금 폴더의 git 주소로 정한 프로젝트 (github.com/<owner>/<repo>, 서버 · 소식 훅과 같은 규칙). 없으면 null
//   site     이 스킬을 넣은 블로그 주소 (cairn connect가 .cairn.json에 적은 값). 없으면 null
// 무늬는 cairn-save의 scripts/secrets.mjs를 함께 쓴다 (cairn connect가 두 스킬을 같은 폴더에 넣는다). Node 내장 모듈만 쓴다.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const skillDir = dirname(dirname(fileURLToPath(import.meta.url)));
const PROJECT = /^[a-z0-9.-]+(\/[a-z0-9._-]+){2,}$/;

/** git 주소 → 프로젝트. 사용자 · 비밀번호 · 포트 · .git은 버리고 소문자로 (서버의 규칙, 소식 훅의 news-state.mjs와 같다) */
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
  return project.length <= 200 && PROJECT.test(project) ? project : null;
}

function git(args) {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2_000,
    }).trim();
  } catch {
    return '';
  }
}

/** 지금 폴더의 git 주소 (origin, 없으면 첫 원격) */
function remote() {
  const origin = git(['remote', 'get-url', 'origin']);
  if (origin) return origin;
  const first = git(['remote']).split('\n')[0];
  return first ? git(['remote', 'get-url', first]) : '';
}

function site() {
  try {
    const marker = JSON.parse(readFileSync(join(skillDir, '.cairn.json'), 'utf8'));
    return typeof marker.site === 'string' ? marker.site : null;
  } catch {
    return null;
  }
}

async function main() {
  // 지우는 순서대로 센다 (앞 무늬가 지운 자리를 뒤 무늬가 다시 세지 않게: sk-ant-…는 Anthropic 키 하나)
  const { redact } = await import(
    pathToFileURL(join(skillDir, '..', 'cairn-save', 'scripts', 'secrets.mjs')).href
  ).catch(() => {
    throw new Error(
      'cairn-save 스킬의 secrets.mjs가 없어요. cairn connect로 스킬을 다시 넣어 주세요',
    );
  });
  const counts = new Map();
  for (const kind of redact(readFileSync(0, 'utf8')).found)
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  const found = [...counts].map(([kind, count]) => ({ kind, count }));
  const result = { ok: found.length === 0, found, project: projectOf(remote()), site: site() };
  console.log(JSON.stringify(result));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
