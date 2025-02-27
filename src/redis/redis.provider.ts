// src/redis/redis.provider.ts
import Redis from 'ioredis';

export const RedisProvider = {
  provide: 'REDIS_CLIENT',
  useFactory: (): Redis => {
    return new Redis({
      // host: process.env.REDIS_HOST || 'localhost',
      host: '43.200.181.46',
      port: Number(process.env.REDIS_PORT) || 6379,
    });
  },
};
