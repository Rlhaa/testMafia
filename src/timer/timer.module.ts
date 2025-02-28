import { Module } from '@nestjs/common';
import { TimerService } from './timer.service';

@Module({
  providers: [TimerService], // TimerService 등록
  exports: [TimerService], // 다른 모듈에서도 사용 가능하도록 export
})
export class TimerModule {}
