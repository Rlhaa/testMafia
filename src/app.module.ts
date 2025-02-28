// src/app.module.ts
import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { GameModule } from './game/game.module';
import { RoomModule } from './room/room.module';
import { NoticeModule } from './notice/notice.module';
import { TimerService } from './timer/timer.service';
import { TimerModule } from './timer/timer.module';

@Module({
  imports: [
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'public'),
    }),
    GameModule,
    RoomModule,
    NoticeModule,
    TimerModule,
  ],
  controllers: [],
  providers: [TimerService],
})
export class AppModule {}
