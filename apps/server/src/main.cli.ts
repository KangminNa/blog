import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { InstallPolicy, OwnerService, SpaceQuery } from './modules/account';
import {
  InvalidRequest,
  OwnerActor,
  PluginManifest,
  PluginRegistry,
  PluginService,
  SystemActor,
} from './modules/platform';

// 명령줄. 서버에 접속할 수 있는 사람 = 주인으로 본다. 관리 화면·설치 마법사도 같은 Service를 부른다.
//
//   pnpm install-code                            설치 코드 (아직 주인이 없을 때)
//   pnpm owner reset-password                    주인 비밀번호 다시 정하기 (표준 입력으로, 모든 로그인이 끝남)
//   pnpm plugin                                  들어 있는 플러그인과 상태
//   pnpm plugin enable <플러그인>                 켜기 (쓰는 권한을 보여주고 허락)
//   pnpm plugin disable <플러그인>                끄기
//   pnpm plugin set <플러그인> <설정> [값]         값 넣기. 값을 빼면 표준 입력에서 읽음 (비밀값용)
//   pnpm plugin <플러그인> <동작>                  관리 동작 (예: sync-github check)
const owner = new OwnerActor('local', 'cli');

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    if (command === 'install-code')
      return await installCode(app.get(SpaceQuery), app.get(InstallPolicy));
    if (command === 'owner' && args[0] === 'reset-password')
      return await resetPassword(app.get(OwnerService));
    if (command === 'plugin')
      return await plugin(app.get(PluginRegistry), app.get(PluginService), args);
    throw new Error('명령을 알 수 없어요. 쓰는 법은 apps/server/src/main.cli.ts 맨 위에');
  } finally {
    await app.close();
  }
}

async function installCode(spaces: SpaceQuery, install: InstallPolicy): Promise<void> {
  const status = await spaces.installStatus(new SystemActor(), null);
  if (status.installed) {
    console.log('이미 설치된 블로그예요. 주인 계정으로 로그인하세요');
    return;
  }
  console.log(`설치 코드: ${install.code()}`);
  console.log(
    `브라우저에서 ${process.env.CAIRN_WEB_URL ?? 'http://localhost:3000'}/install 을 열고 이 코드를 넣으세요`,
  );
}

async function resetPassword(owners: OwnerService): Promise<void> {
  const plain = await readStdin(
    '새 비밀번호를 표준 입력으로 주세요. 예: read -rs P && printf %s "$P" | pnpm owner reset-password',
  );
  const owner = await owners.resetPassword(new SystemActor(), plain);
  console.log(`✔ ${owner.login}의 비밀번호를 다시 정했어요. 모든 로그인이 끝났어요`);
}

async function plugin(
  registry: PluginRegistry,
  plugins: PluginService,
  args: readonly string[],
): Promise<void> {
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

async function readStdin(
  hint = '값을 주세요. 비밀값은 echo 값 | pnpm plugin set … 처럼 표준 입력으로 넘기세요',
): Promise<string> {
  if (process.stdin.isTTY) throw new Error(hint);
  let data = '';
  for await (const chunk of process.stdin) data += chunk;
  return data.trim();
}

main().catch((error) => {
  console.error(`✖ ${(error as Error).message}`);
  if (error instanceof InvalidRequest)
    for (const [field, problem] of error.fields) console.error(`  ${field}: ${problem}`);
  process.exit(1);
});
