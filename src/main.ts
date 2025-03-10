// src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as Sentry from '@sentry/node';
import { AllExceptionFilter } from './exception.filter';

async function bootstrap() {
  // sentry 초기화
  Sentry.init({
    dsn: process.env.dsn ,
    tracesSampleRate: 1.0,
  });

  throw new Error("해당 에러는 마피아를 위해 일부로 발생시킴")

  const app = await NestFactory.create(AppModule);
  // 프로젝트에서 발생한 모든에러를 Sentry 필터 적용
  app.useGlobalFilters(new AllExceptionFilter());


  await app.listen(3001);
  console.log('서버가 http://localhost:3001 에서 실행 중입니다.');
}
bootstrap();
