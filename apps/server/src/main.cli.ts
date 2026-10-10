import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { OwnerActor, PluginManifest, PluginRegistry, PluginService } from './modules/platform';

// 명령줄: 관리 화면이 생기기 전에 플러그인을 켜고 설정한다. 서버에 접속할 수 있는 사람 = 주인으로 본다.
// 관리 화면·설치 마법사도 같은 PluginService를 부른다.
//
//   pnpm plugin                                  들어 있는 플러그인과 상태
//   pnpm plugin enable <플러그인>                 켜기 (쓰는 권한을 보여주고 허락)
//   pnpm plugin disable <플러그인>                끄기
//   pnpm plugin set <플러그인> <설정> [값]         값 넣기. 값을 빼면 표준 입력에서 읽음 (비밀값용)
//   pnpm plugin <플러그인> <동작>                  관리 동작 (예: sync-github check)
const owner = new OwnerActor('local', 'cli');

async function main() {
  const args = process.argv.slice(2);
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const registry = app.get(PluginRegistry);
  const plugins = app.get(PluginService);
  try {
    const [first, name, key, value] = args;
    if (!first) return list(registry);
    if (first === 'enable' && name) {
      const manifest = registry.manifest(name);
      if (!manifest) throw new Error(`들어 있는 플러그인 중에 ${name}이(가) 없어요`);
      await plugins.enable(owner, name);
      console.log(`✔ ${name}을(를) 켰어요. 허락한 것:`);
      for (const use of manifest.uses) console.log(`  · ${PluginManifest.describeUse(use)}`);
      return report(registry, name);
    }
    if (first === 'disable' && name) {
      await plugins.disable(owner, name);
      console.log(`✔ ${name}을(를) 껐어요`);
      return;
    }
    if (first === 'set' && name && key) {
      const input = value ?? (await readStdin());
      await plugins.set(owner, name, key, input);
      const secret = registry.manifest(name)?.setting(key)?.isSecret;
      console.log(`✔ ${name}.${key} = ${secret ? '(비밀값, 암호화해서 저장)' : input || '(지움)'}`);
      return report(registry, name);
    }
    if (name) {
      const found = registry.action(first, name);
      if (!found)
        throw new Error(
          `${first}에 ${name} 동작이 없어요 (켜져 있고 설정이 끝났는지 pnpm plugin 으로 확인)`,
        );
      const result = await found.action.run(owner);
      console.log(`${result.ok ? '✔' : '✖'} ${result.message}`);
      for (const line of result.details) console.log(`  ${line}`);
      process.exitCode = result.ok ? 0 : 1;
      return;
    }
    throw new Error('명령을 알 수 없어요. 쓰는 법은 apps/server/src/main.cli.ts 맨 위에');
  } finally {
    await app.close();
  }
}

function list(registry: PluginRegistry): void {
  for (const m of registry.installed()) {
    const state = registry.state(m.name);
    const status = !state?.enabled
      ? '꺼짐'
      : state.isActiveFor(m)
        ? '켜짐'
        : '켜짐 (다시 허락 필요)';
    console.log(`${m.name} ${m.version} [${status}]  ${m.description}`);
    report(registry, m.name);
  }
}

function report(registry: PluginRegistry, name: string): void {
  const m = registry.manifest(name);
  if (!m) return;
  const state = registry.state(name);
  for (const spec of m.settings) {
    const stored = state?.storedSetting(spec.key);
    const shown = !stored
      ? spec.defaultValue
        ? `(기본값 ${spec.defaultValue})`
        : '(비어 있음)'
      : spec.isSecret
        ? '(설정됨)'
        : stored.value;
    console.log(`    ${spec.key}${spec.required ? '*' : ''}  ${spec.label}: ${shown}`);
  }
  const problem = registry.problem(name);
  if (problem) console.log(`    ✖ 동작하지 못함: ${problem}`);
  for (const a of registry.actions().filter((x) => x.plugin === name)) {
    console.log(`    → pnpm plugin ${name} ${a.name}   ${a.action.label}`);
  }
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY)
    throw new Error(
      '값을 주세요. 비밀값은 echo 값 | pnpm plugin set … 처럼 표준 입력으로 넘기세요',
    );
  let data = '';
  for await (const chunk of process.stdin) data += chunk;
  return data.trim();
}

main().catch((error) => {
  console.error(`✖ ${(error as Error).message}`);
  process.exit(1);
});
