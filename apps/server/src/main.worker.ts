import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { OutboxWorker } from './modules/platform';

// 일꾼 진입점: HTTP를 열지 않고 이벤트 넘기기와 반복 작업만 한다.
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  app.enableShutdownHooks();
  app.get(OutboxWorker).start();
}

void bootstrap();
