// PreToolUse(Edit|Write): 이미 커밋된 마이그레이션 파일은 고치지 못하게 막는다.
// 이미 적용된 DB가 있을 수 있으므로, 바꿀 내용은 새 마이그레이션 파일로 만든다.
import { spawnSync } from 'node:child_process';
import { relative } from 'node:path';

const input = JSON.parse(await new Response(process.stdin).text());
const file = input.tool_input?.file_path;
const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
if (!file) process.exit(0);

const rel = relative(root, file);
if (!rel.startsWith('db/migrations/')) process.exit(0);

const committed = spawnSync('git', ['cat-file', '-e', `HEAD:${rel}`], { cwd: root }).status === 0;
if (committed) {
  process.stderr.write(
    `${rel}은 이미 커밋된 마이그레이션이라 고칠 수 없습니다. ` +
      '`pnpm db:new <이름>`으로 새 마이그레이션을 만들어 바꾸세요.\n',
  );
  process.exit(2);
}
