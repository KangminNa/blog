import { Runner, RunnerHalted } from './runner';
import { ConfigProblem, RunnerConfig } from './runner-config';

// 러너 진입점. 사용법은 .env.example, 설계는 docs/객체설계.md 13장.
async function main(): Promise<void> {
  const runner = new Runner(RunnerConfig.fromEnv(process.env));
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => runner.stop());
  await runner.run();
}

main().catch((error: unknown) => {
  const known = error instanceof ConfigProblem || error instanceof RunnerHalted;
  console.error(known ? error.message : error);
  process.exit(1);
});
