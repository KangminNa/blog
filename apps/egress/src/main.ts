import { readFileSync } from 'node:fs';
import { AllowList, AllowListProblem } from './allow-list';
import { EgressProxy } from './egress-proxy';

// 나가는 프록시 진입점 (docs/코드작업.md). 허용 목록을 읽어 CONNECT 프록시를 띄운다.
//   EGRESS_ALLOW_FILE  허용 목록 파일 (기본 /etc/cairn/allow.txt, compose가 읽기 전용으로 붙인다)
//   EGRESS_PORT        듣는 포트 (기본 3128)
// 허용 목록이 틀리면 시작하지 않는다. 목록을 바꾸면 다시 시작한다.
async function main(): Promise<void> {
  const file = process.env.EGRESS_ALLOW_FILE ?? '/etc/cairn/allow.txt';
  const port = Number(process.env.EGRESS_PORT ?? 3128);
  const allow = AllowList.parse(readFileSync(file, 'utf8'));
  const proxy = new EgressProxy(allow, (line) => console.log(line));
  const address = await proxy.listen(port);
  console.log(`나가는 프록시를 시작했어요: :${address.port}, 허용 규칙 ${allow.size}개 (${file})`);
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.once(signal, () => {
      void proxy.close().then(() => process.exit(0));
    });
}

main().catch((error: unknown) => {
  console.error(error instanceof AllowListProblem ? `허용 목록이 틀려요: ${error.message}` : error);
  process.exit(1);
});
