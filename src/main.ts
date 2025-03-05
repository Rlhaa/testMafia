import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { RedisIoAdapter } from './redis.adapter';
import { RedisProvider } from 'src/redis/redis.provider';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Redis 클라이언트 주입
  const redisClient = RedisProvider.useFactory();
  app.useWebSocketAdapter(new RedisIoAdapter(redisClient));

  await app.listen(3000);
}
bootstrap();
