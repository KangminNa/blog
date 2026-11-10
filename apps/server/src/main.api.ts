import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { InstallPolicy, ServerRunnerGateway, SpaceQuery } from './modules/account';
import { HttpSetup, SystemActor } from './modules/platform';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  HttpSetup.apply(app);
  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port, '0.0.0.0');
  console.log(`cairn api listening on :${port}`);

  // 서버 러너 · 코드 러너 칸이 스스로 연결할 연결 값을 볼륨에 쓴다 (러너가 없는 배포면 하지 않는다)
  try {
    for (const file of await app.get(ServerRunnerGateway).publish())
      console.log(`러너 연결 값을 썼어요: ${file}`);
  } catch (error) {
    console.error(`러너 연결 값을 쓰지 못했어요: ${(error as Error).message}`);
  }

  // 아직 주인이 없으면 설치 코드를 알려준다 (pnpm install-code로도 볼 수 있음)
  const status = await app.get(SpaceQuery).installStatus(new SystemActor(), null);
  if (!status.installed)
    console.log(
      `설치 코드: ${app.get(InstallPolicy).code()}  (브라우저에서 ${process.env.CAIRN_WEB_URL ?? 'http://localhost:3000'}/install 을 열고 이 코드를 넣으세요)`,
    );
}

void bootstrap();
