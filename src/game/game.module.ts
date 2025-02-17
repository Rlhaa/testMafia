// src/game/game.module.ts
import { Module } from '@nestjs/common';
import { GameGateway } from './game.gateway';
import { GameService } from './game.service';
import { RedisProvider } from 'src/redis/redis.provider';

@Module({
  providers: [GameGateway, GameService, RedisProvider],
  exports: [GameService],
})
export class GameModule {}
