// src/redis/redis.provider.ts
// import Redis from 'ioredis';

// export const RedisProvider = {
//   provide: 'REDIS_CLIENT',
//   useFactory: (): Redis => {
//     return new Redis({
//       // host: process.env.REDIS_HOST || 'localhost',
//       host: '43.200.181.46',
//       port: Number(process.env.REDIS_PORT) || 6379,
//     });
//   },
// };
import Redis from 'ioredis';

export const RedisProvider = {
  provide: 'REDIS_CLIENT',
  useFactory: (): { pub: Redis; sub: Redis } => {
    return {
      pub: new Redis({
        host: '43.200.181.46',
        port: Number(process.env.REDIS_PORT) || 6379,
      }),
      sub: new Redis({
        host: '43.200.181.46',
        port: Number(process.env.REDIS_PORT) || 6379,
      }),
    };
  },
};
