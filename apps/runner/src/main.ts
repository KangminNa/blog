import { Redactor, RunLog } from './redactor';
import { Runner, RunnerHalted, TokenRejected } from './runner';
import { ConfigProblem, RunnerConfig } from './runner-config';
import { ServerPairing } from './server-pairing';

// 러너 진입점. 사용법은 .env.example, 설계는 docs/객체설계.md 13장.
// 기기 토큰이 있으면 그 토큰으로 돈다. 서버 러너(토큰 없이 연결 값 파일)는 연결 값으로 토큰을 받고,
// 토큰이 거절되면(주인이 끊음, 다른 러너가 다시 연결함) 다시 받아 이어 간다.
async function main(): Promise<void> {
  const config = RunnerConfig.fromEnv(process.env);
  const stopper = new AbortController();
  let current: Runner | null = null;
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.on(signal, () => {
      stopper.abort();
      current?.stop();
    });
  const log = new RunLog(new Redactor([config.deviceToken]));
  const pairing = config.pairingFile
    ? new ServerPairing(config.serverUrl, config.pairingFile, log)
    : null;

  while (!stopper.signal.aborted) {
    const token = config.deviceToken ?? (await pairing?.token(stopper.signal)) ?? null;
    if (token === null) return;
    current = new Runner(config.withToken(token));
    try {
      await current.run();
      return;
    } catch (error) {
      if (!(pairing && error instanceof TokenRejected)) throw error;
      log.info(`서버가 토큰을 거절해 다시 연결해요: ${error.message}`);
    }
  }
}

main().catch((error: unknown) => {
  const known = error instanceof ConfigProblem || error instanceof RunnerHalted;
  console.error(known ? error.message : error);
  process.exit(1);
});
