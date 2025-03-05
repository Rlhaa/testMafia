import { IoAdapter } from '@nestjs/platform-socket.io';
import { ServerOptions, Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';
import { Inject, Injectable } from '@nestjs/common';

@Injectable()
export class RedisIoAdapter extends IoAdapter {
  constructor(@Inject('REDIS_CLIENT') private readonly redisClient: Redis) {
    super();
  }

  createIOServer(port: number, options?: ServerOptions): Server {
    const server = super.createIOServer(port, options) as Server;

    // Redis Pub/Sub 클라이언트 복제
    const pubClient = this.redisClient;
    const subClient = this.redisClient.duplicate();

    // ✅ 서버 전체에 Redis 어댑터 적용 (올바른 대상 수정)
    server.adapter(createAdapter(pubClient, subClient));

    return server;
  }
}
