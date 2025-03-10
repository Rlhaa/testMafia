import { Module } from '@nestjs/common';
import { TimerService } from './timer.service';
import { RedisProvider } from 'src/redis/redis.provider';

@Module({
  providers: [TimerService, RedisProvider], // TimerService 등록
  exports: [TimerService], // 다른 모듈에서도 사용 가능하도록 export
})
export class TimerModule {}
