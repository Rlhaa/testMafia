// src/app.module.ts
import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { GameModule } from './game/game.module';
import { RoomModule } from './room/room.module';
import { NoticeModule } from './notice/notice.module';
import { TimerService } from './timer/timer.service';
import { TimerModule } from './timer/timer.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { RedisProvider } from './redis/redis.provider';

@Module({
  imports: [
    // ServeStaticModule.forRoot({
    //   rootPath: join(__dirname, '..', 'public'),
    // }),
    GameModule,
    RoomModule,
    NoticeModule,
    TimerModule,
  ],
  controllers: [AppController],
  providers: [AppService, TimerService, RedisProvider],
})
export class AppModule {}
