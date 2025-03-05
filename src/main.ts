import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { RedisIoAdapter } from './redis.adapter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  const redisClient = app.get('REDIS_CLIENT');
  app.useWebSocketAdapter(new RedisIoAdapter(redisClient));

  console.log('서버가 정상적으로 실행')
  await app.listen(3000);
}
bootstrap();
