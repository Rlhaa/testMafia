// src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { RedisIoAdapter } from './redis.adapter'; 

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useWebSocketAdapter(new RedisIoAdapter(app))

  await app.listen(3000);
  console.log('서버가 http://localhost:3000 에서 실행 중입니다.');
}
bootstrap();
