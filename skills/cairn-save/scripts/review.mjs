// 다른 AI 명령줄로 검토하기 (하위 에이전트를 띄울 수 없을 때, 또는 다른 회사 모델로 교차 검토할 때).
//
//   node review.mjs <work> fact|boundary [--with claude|codex|gemini]
//
// 검토자는 이 대화를 모른다. 지시문(reviewers.md)과 초안·근거 묶음·노트 규칙만 표준 입력으로 받는다.
// --with가 없으면 cairn connect --review-with로 고른 것(.cairn.json의 review_with), 그것도 없으면 이 컴퓨터에 있는 것 중
// 지금 도구와 다른 것을 먼저 고른다. 결과는 <work>/review-<종류>-<n>.md에 남기고 그대로 찍는다.
// 쓸 수 있는 명령줄이 없으면 종료 코드 2: 스킬은 "직접 검토"로 넘어간다.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const skillDir = dirname(dirname(fileURLToPath(import.meta.url)));
const [work, kind, ...rest] = process.argv.slice(2);
if (!work || !['fact', 'boundary'].includes(kind ?? ''))
  throw new Error('쓰는 법: node review.mjs <work> fact|boundary [--with claude|codex|gemini]');

const read = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : '');
const marker = (() => {
  try {
    return JSON.parse(read(join(skillDir, '.cairn.json')) || '{}');
  } catch {
    return {};
  }
})();

/** 검토용 명령줄: [이름, 명령, 인자]. 지시는 인자로, 자료는 표준 입력으로 넘긴다. 파일을 바꾸지 못하게 읽기 전용으로 */
const RUNNERS = {
  claude: (prompt) => ['claude', ['-p', prompt, '--output-format', 'text']],
  codex: (prompt) => ['codex', ['exec', '--ephemeral', '--sandbox', 'read-only', prompt]],
  gemini: (prompt) => ['gemini', ['-p', prompt]],
};
const available = (name) =>
  spawnSync(name, ['--version'], { stdio: 'ignore', shell: process.platform === 'win32' })
    .status === 0;
const current =
  process.env.CLAUDE_CODE_SESSION_ID || process.env.CLAUDECODE
    ? 'claude'
    : process.env.CODEX_THREAD_ID
      ? 'codex'
      : null;
const wanted = rest.includes('--with') ? rest[rest.indexOf('--with') + 1] : marker.review_with;
const order = wanted
  ? [wanted]
  : [...Object.keys(RUNNERS).filter((n) => n !== current), current].filter(Boolean);
const runner = order.find((name) => RUNNERS[name] && available(name));
if (!runner) {
  console.log(JSON.stringify({ ok: false, reason: '검토용 AI 명령줄 없음 → 직접 검토' }));
  process.exit(2);
}

// 지시문: 공통 규칙 + 이 검토의 부분
const guide = read(join(skillDir, 'references', 'reviewers.md'));
const part = (title) => guide.split(/^## /m).find((s) => s.startsWith(title)) ?? '';
const instruction = [
  '너는 Cairn 세션 노트의 검토자다. 아래 표준 입력의 자료만 보고 검토한다. 파일을 만들거나 고치지 않는다.',
  `## ${part('공통 규칙')}`,
  `## ${part(kind === 'fact' ? '사실 검토' : '경계 검토')}`,
  '결과는 공통 규칙의 모양으로만 쓴다.',
].join('\n\n');
const material = [
  '# 노트 규칙 (note-rules.md)',
  read(join(skillDir, 'references', 'note-rules.md')),
  '# 초안 (draft.md)',
  read(join(work, 'draft.md')),
  ...(kind === 'fact' ? ['# 근거 묶음 (evidence.md)', read(join(work, 'evidence.md'))] : []),
].join('\n\n');

const [command, args] = RUNNERS[runner](instruction);
const result = spawnSync(command, args, {
  input: material,
  encoding: 'utf8',
  timeout: 5 * 60_000,
  maxBuffer: 10 * 1024 * 1024,
  shell: process.platform === 'win32',
});
const output = `${result.stdout ?? ''}`.trim();
if (result.status !== 0 || !output) {
  console.log(
    JSON.stringify({
      ok: false,
      reason: `${runner} 검토 실패: ${(result.stderr || result.error?.message || '').slice(0, 300)}`,
    }),
  );
  process.exit(2);
}
const n = readdirSync(work).filter((f) => f.startsWith(`review-${kind}-`)).length + 1;
const file = join(work, `review-${kind}-${n}.md`);
writeFileSync(file, `${output}\n`, { mode: 0o600 });
console.log(`검토자: ${runner} (다른 맥락)\n파일: ${file}\n\n${output}`);
