import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { InstallPolicy, SpaceQuery } from './modules/account';
import { HttpSetup, SystemActor } from './modules/platform';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  HttpSetup.apply(app);
  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port, '0.0.0.0');
  console.log(`cairn api listening on :${port}`);

  // 아직 주인이 없으면 설치 코드를 알려준다 (pnpm install-code로도 볼 수 있음)
  const status = await app.get(SpaceQuery).installStatus(new SystemActor(), null);
  if (!status.installed)
    console.log(
      `설치 코드: ${app.get(InstallPolicy).code()}  (브라우저에서 ${process.env.CAIRN_WEB_URL ?? 'http://localhost:3000'}/install 을 열고 이 코드를 넣으세요)`,
    );
}

void bootstrap();
