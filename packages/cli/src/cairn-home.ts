import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { SkillPackage } from './skill';
import { CliError } from './terminal';

// 이 컴퓨터의 ~/.cairn (훅 · 상태 줄 스크립트와 함께 쓴다):
//   bin/*.mjs          훅 · 상태 줄 · 세션 저장 스크립트. 이 명령에 든 hooks/와 cairn-save 스킬의 비밀값 무늬(secrets.mjs)를
//                      그대로 복사한다 (~/.cairn/bin만으로 돈다). 늘 새로 쓴다
//   credentials.json   기기의 열쇠 (news · collect, 0600 · 폴더 0700). 다른 키는 그대로 둔다
//   outbox/*.json      아직 올리지 못한 세션 (cairn-collect.mjs가 쓰고 지운다)
//   collect.json       마지막으로 세션을 올린 때 { saved_at, status }
export class CairnHome {
  private static readonly SCRIPTS = join(__dirname, '../hooks');

  constructor(readonly dir: string) {}

  /** ~/.cairn/bin의 스크립트 하나 */
  script(name: string): string {
    return join(this.dir, 'bin', name);
  }

  private get credentialsFile(): string {
    return join(this.dir, 'credentials.json');
  }

  /** 스크립트는 이 명령에 든 판으로 늘 새로 쓴다 (고친 판이 다음 connect에서 들어가게) */
  installScripts(): void {
    const root = SkillPackage.root();
    const secrets = root ? join(root, 'cairn-save', 'scripts', 'secrets.mjs') : '';
    if (!secrets || !existsSync(secrets))
      throw new CliError('함께 든 스킬이 없어요 (설치가 망가졌어요)');
    const bin = join(this.dir, 'bin');
    mkdirSync(bin, { recursive: true, mode: 0o700 });
    for (const file of readdirSync(CairnHome.SCRIPTS).filter((f) => f.endsWith('.mjs')))
      copyFileSync(join(CairnHome.SCRIPTS, file), join(bin, file));
    copyFileSync(secrets, join(bin, 'secrets.mjs'));
  }

  credentials(): Record<string, unknown> {
    try {
      return JSON.parse(readFileSync(this.credentialsFile, 'utf8')) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  /** 기기 하나의 열쇠를 둔다. 나만 읽게 (0600, 폴더 0700) */
  saveCredential(key: string, value: object): void {
    const all = { ...this.credentials(), [key]: value };
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const temp = `${this.credentialsFile}.tmp`;
    writeFileSync(temp, `${JSON.stringify(all, null, 2)}\n`, { mode: 0o600 });
    chmodSync(temp, 0o600);
    renameSync(temp, this.credentialsFile);
  }

  /** 아직 올리지 못한 세션 수 */
  outboxCount(): number {
    try {
      return readdirSync(join(this.dir, 'outbox')).filter((f) => f.endsWith('.json')).length;
    } catch {
      return 0;
    }
  }

  /** 마지막으로 세션을 올린 때. 없으면 null */
  lastSaved(): Date | null {
    try {
      const saved = JSON.parse(readFileSync(join(this.dir, 'collect.json'), 'utf8')) as {
        saved_at?: unknown;
      };
      const at = new Date(String(saved.saved_at));
      return Number.isNaN(at.getTime()) ? null : at;
    } catch {
      return null;
    }
  }
}
