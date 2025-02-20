// src/rooms/room.module.ts
import { Module, forwardRef } from '@nestjs/common';
import { RoomController } from './room.controller';
import { RoomGateway } from './room.gateway';
import { RoomService } from './room.service';
import { RedisProvider } from 'src/redis/redis.provider';
import { GameModule } from 'src/game/game.module';

@Module({
  imports: [forwardRef(() => GameModule)],
  controllers: [RoomController],
  providers: [RoomGateway, RoomService, RedisProvider],
  exports: [RoomService, RoomGateway],
})
export class RoomModule {}
