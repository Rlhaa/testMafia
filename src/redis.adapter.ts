import { IoAdapter } from '@nestjs/platform-socket.io';
import { Redis } from 'ioredis';
import { Inject, Injectable } from '@nestjs/common';

@Injectable()
export class RedisIoAdapter extends IoAdapter {
  constructor(@Inject('REDIS_CLIENT') private readonly redisClient: Redis) {
    super();
  }

  createIOServer(port: number, options?: any) {
    options = {
      ...options,
      adapter: require('socket.io-redis')({
        pubClient: this.redisClient,
        subClient: this.redisClient.duplicate(),
      }),
    };
    return super.createIOServer(port, options);
  }
}
