// src/game/game.module.ts
import { Module, forwardRef } from '@nestjs/common';
import { GameService } from './game.service';
import { RedisProvider } from 'src/redis/redis.provider';
import { RoomService } from 'src/room/room.service';
import { RoomModule } from 'src/room/room.module';
import { NoticeModule } from 'src/notice/notice.module'; // NoticeModule 임포트

@Module({
  imports: [forwardRef(() => RoomModule), NoticeModule],
  providers: [GameService, RedisProvider, RoomService], // NightResultService 제거
  exports: [GameService],
})
export class GameModule {}
