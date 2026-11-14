import type { AiTool } from './ai-tool';
import { ClaudeCode } from './claude-code';
import { Codex } from './codex';
import { ConnectCommand, REVIEWERS } from './connect.command';
import { NewsLogin } from './news-login';
import { NewsSetup } from './news-setup';
import { Shell } from './shell';
import { SkillPackage } from './skill';
import { StatusCommand } from './status.command';
import { CliError, Terminal } from './terminal';

// 작업하는 컴퓨터의 AI 도구를 Cairn 블로그에 연결하는 명령. 저장소에서는 `pnpm cairn …`, npm 배포 뒤에는 npx로 부른다.
// ChatGPT·Claude 앱(웹·데스크톱 채팅)은 이 명령이 아니라 블로그 관리 화면의 기기 시트 안내를 따른다.
const HELP = `cairn: 작업하는 컴퓨터의 AI 도구를 Cairn 블로그에 연결한다

  cairn connect <블로그 주소> [--tool claude-code|codex] [--review-with claude|codex|gemini] [--yes]
      스킬 · 검토자 넣기 + MCP 등록 + 로그인 + 연결 확인
      Claude Code는 팀 소식도: 소식 기기(소식 읽기만) + 말을 걸 때마다 소식을 덧붙이는 훅 + 상태 줄
      --review-with: 다른 회사 모델로 교차 검토할 때 쓸 명령줄
  cairn status [--tool claude-code|codex]   넣은 스킬과 연결 상태, 소식 기기 · 훅 · 상태 줄

ChatGPT · Claude 앱은 블로그 관리 화면 → 기기에서 연결해요.`;

async function main(argv: readonly string[]): Promise<void> {
  const [command, ...rest] = argv;
  const option = (name: string) => {
    const at = rest.indexOf(name);
    return at >= 0 ? (rest[at + 1] ?? '') : null;
  };
  const values = new Set([option('--tool'), option('--review-with')]);
  const args = rest.filter(
    (a, i) => !a.startsWith('-') && !(values.has(a) && rest[i - 1]?.startsWith('--')),
  );
  const terminal = new Terminal(rest.includes('--yes') || rest.includes('-y'));
  const shell = new Shell();
  const tools: Record<string, AiTool> = {
    'claude-code': new ClaudeCode(shell),
    codex: new Codex(shell),
  };
  const tool = tools[option('--tool') ?? 'claude-code'];
  if (!tool) throw new CliError(`--tool은 ${Object.keys(tools).join(' · ')} 중 하나예요`);
  const reviewWith = option('--review-with');
  if (reviewWith !== null && !(REVIEWERS as readonly string[]).includes(reviewWith))
    throw new CliError(`--review-with는 ${REVIEWERS.join(' · ')} 중 하나예요`);
  const skills = SkillPackage.bundled();
  const settings = tool.settingsFile;
  const news = settings ? new NewsSetup(terminal, settings, new NewsLogin(terminal, shell)) : null;
  if (command === 'connect' && args[0])
    return new ConnectCommand(terminal, tool, skills, reviewWith, news).run(args[0]);
  if (command === 'status') return new StatusCommand(terminal, tool, skills, news).run();
  terminal.say(HELP);
  if (command) process.exitCode = 1;
}

main(process.argv.slice(2)).catch((error: unknown) => {
  if (error instanceof CliError) process.stderr.write(`✗ ${error.message}\n`);
  else process.stderr.write(`${(error as Error).stack ?? String(error)}\n`);
  process.exitCode = 1;
});
