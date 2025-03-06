import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as Sentry from '@sentry/node';
import { AllExceptionFilter } from './exception.filter';

async function bootstrap() {
  // Sentry 초기화
  Sentry.init({
    dsn: "https://7093f1075ffe2a3854e91d0c6818ddc7@o4508924635185152.ingest.us.sentry.io/4508924637151232" ,
    tracesSampleRate: 1.0,
  });

  // throw new Error("tomato 에서 발생한 에러")
  const app = await NestFactory.create(AppModule);

  // 프로젝트에서 발생한 모든에러를 Sentry 필터 적용
  app.useGlobalFilters(new AllExceptionFilter());


  await app.listen(3000);
}

bootstrap();