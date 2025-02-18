// src/game/game.module.ts
import { Module } from '@nestjs/common';

import { GameService } from './game.service';
import { RedisProvider } from 'src/redis/redis.provider';
import { RoomService } from 'src/room/room.service';

@Module({
  providers: [GameService, RedisProvider, RoomService],
  exports: [GameService],
})
export class GameModule {}
