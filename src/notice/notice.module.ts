import { forwardRef, Module } from '@nestjs/common';
import { NightResultService } from './night-result.service';
import { RoomModule } from 'src/room/room.module';
import { GameModule } from 'src/game/game.module';

@Module({
  imports: [forwardRef(() => GameModule), forwardRef(() => RoomModule)],
  providers: [NightResultService],
  exports: [NightResultService], // 다른 모듈에서 사용해야 한다면 exports에도 등록
})
export class NoticeModule {}
