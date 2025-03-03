import { IoAdapter } from '@nestjs/platform-socket.io';
import { INestApplication } from '@nestjs/common';
import { createAdapter } from '@socket.io/redis-adapter'; // 변경된 부분
import { createClient } from 'redis'; // 최신 Redis 클라이언트

export class RedisIoAdapter extends IoAdapter {
  private readonly pubClient;
  private readonly subClient;

  constructor(app: INestApplication) {
    super(app);

    // 비동기 연결을 위한 처리
    this.pubClient = createClient({
      url: `redis://43.200.181.46:${process.env.REDIS_PORT || 6379}`,
    });

    this.subClient = createClient({
      url: `redis://43.200.181.46:${process.env.REDIS_PORT || 6379}`,
    });

    // Redis 연결을 기다리는 비동기 함수 작성
    this.connectRedis();
  }

  // Redis 연결 비동기 처리
  private async connectRedis() {
    await this.pubClient.connect();
    await this.subClient.connect();
  }

  createIOServer(port: number, options?: any): any {
    const server = super.createIOServer(port, options);
    server.adapter(createAdapter(this.pubClient, this.subClient));
    return server;
  }
}
