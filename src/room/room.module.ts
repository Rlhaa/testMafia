// src/rooms/room.module.ts
import { Module } from '@nestjs/common';
import { RoomController } from './room.controller';
import { RoomGateway } from './room.gateway';
import { RoomService } from './room.service';
import { RedisProvider } from 'src/redis/redis.provider';
import { GameModule } from 'src/game/game.module';

@Module({
  imports: [GameModule],
  controllers: [RoomController],
  providers: [RoomGateway, RoomService, RedisProvider],
  exports: [RoomService],
})
export class RoomModule {}
