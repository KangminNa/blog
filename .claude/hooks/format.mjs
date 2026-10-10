// PostToolUse(Edit|Write): 고친 파일을 Biome으로 포맷·린트 자동 수정한다.
// 고치지 못한 린트 오류가 남으면 exit 2로 Claude에게 알려 바로 고치게 한다.
import { spawnSync } from 'node:child_process';
import { relative } from 'node:path';

const input = JSON.parse(await new Response(process.stdin).text());
const file = input.tool_input?.file_path;
const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
if (!file || !/\.(ts|tsx|js|mjs|json)$/.test(file)) process.exit(0);

const rel = relative(root, file);
if (rel.startsWith('..')) process.exit(0);

const res = spawnSync(
  'pnpm',
  ['exec', 'biome', 'check', '--write', '--no-errors-on-unmatched', rel],
  {
    cwd: root,
    encoding: 'utf8',
  },
);
if (res.status !== 0) {
  process.stderr.write(`Biome이 고치지 못한 문제가 있습니다 (${rel}):\n${res.stdout}${res.stderr}`);
  process.exit(2);
}
