// src/game/game.module.ts
import { Module, forwardRef } from '@nestjs/common';

import { GameService } from './game.service';
import { RedisProvider } from 'src/redis/redis.provider';
import { RoomService } from 'src/room/room.service';
import { RoomModule } from 'src/room/room.module';
import { NightResultService } from './night-result.service';

@Module({
  imports: [forwardRef(() => RoomModule)],
  providers: [GameService, RedisProvider, RoomService, NightResultService],
  exports: [GameService],
})
export class GameModule {}
