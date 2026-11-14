import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Claude Code의 사용자 설정 (~/.claude/settings.json). 훅을 더할 때 사용자의 훅은 지우거나 덮지 않는다.
// 우리 훅은 명령에 든 스크립트 이름으로 알아본다 (경로가 바뀌었어도). 읽을 수 없는 모양이면 건드리지 않는다.
export class ClaudeSettings {
  constructor(readonly file: string) {}

  /** 설정. 없으면 빈 것, 읽을 수 없는 모양이면 null */
  read(): Record<string, unknown> | null {
    if (!existsSync(this.file)) return {};
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }

  /** 통째로 바꿔 쓴다 (Claude Code가 반쯤 쓴 파일을 읽지 않게) */
  write(settings: Record<string, unknown>): void {
    mkdirSync(join(this.file, '..'), { recursive: true });
    const temp = `${this.file}.cairn.tmp`;
    writeFileSync(temp, `${JSON.stringify(settings, null, 2)}\n`);
    renameSync(temp, this.file);
  }

  /** 그 이벤트(UserPromptSubmit · SessionEnd …)에 우리 스크립트의 훅이 있는가 */
  hasHook(settings: Record<string, unknown>, event: string, script: string): boolean {
    return this.entries(settings, event).some((h) => ClaudeSettings.ours(h.command, script));
  }

  /** 우리 훅을 그 이벤트에 하나 더한다 (경로가 바뀌었으면 고친다). 바꿨으면 true */
  addHook(
    settings: Record<string, unknown>,
    event: string,
    script: string,
    command: string,
    timeout: number,
  ): boolean {
    const mine = this.entries(settings, event).find((h) => ClaudeSettings.ours(h.command, script));
    if (mine?.command === command) return false;
    if (mine) {
      mine.command = command;
      return true;
    }
    const hooks = (settings.hooks ?? {}) as Record<string, unknown>;
    const groups = Array.isArray(hooks[event]) ? (hooks[event] as unknown[]) : [];
    hooks[event] = [...groups, { hooks: [{ type: 'command', command, timeout }] }];
    settings.hooks = hooks;
    return true;
  }

  /** 우리 스크립트를 부르는 명령인가 */
  static ours(command: unknown, script: string): boolean {
    return typeof command === 'string' && command.includes(script);
  }

  private entries(settings: Record<string, unknown>, event: string): { command?: unknown }[] {
    const groups = (settings.hooks as Record<string, unknown> | undefined)?.[event];
    if (!Array.isArray(groups)) return [];
    return groups.flatMap((group) =>
      Array.isArray((group as { hooks?: unknown }).hooks)
        ? ((group as { hooks: { command?: unknown }[] }).hooks ?? [])
        : [],
    );
  }
}
