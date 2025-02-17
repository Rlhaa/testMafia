// src/rooms/room.module.ts
import { Module } from '@nestjs/common';
import { RoomGateway } from './room.gateway';
import { RoomService } from './room.service';
import { RoomController } from './room.controller';

@Module({
  controllers: [RoomController],
  providers: [RoomGateway, RoomService],
  exports: [RoomService],
})
export class RoomModule {}
