import { Injectable, Logger } from '@nestjs/common';
import { Observable, Subject, timer } from 'rxjs';
import { map, takeUntil } from 'rxjs/operators';

@Injectable()
export class TimerService {
  private readonly logger = new Logger(TimerService.name);
  private stopSubjects: Map<string, Subject<void>> = new Map(); // 타이머 취소용 Subject

  /**
   * 타이머 시작 (RxJS timer 활용)
   * @param roomId - 게임 방 ID
   * @param phase - 취소할 타이머 종류 (예: 'day', 'night', 'vote')
   * @param duration - 제한 시간 (ms 단위)
   * @returns Observable<void> - 시간이 지나면 실행되는 Observable 반환
   */
  startTimer(
    roomId: string,
    phase: string,
    duration: number,
  ): Observable<void> {
    if (!roomId || !phase) {
      this.logger.error('Invalid room ID provided');
      throw new Error('Invalid room ID');
    }
    const key = `${roomId}:${phase}`;

    // 기존 타이머가 있다면 취소
    if (this.stopSubjects.has(roomId)) {
      this.logger.warn(`Timer already running for room ${key}`);
      this.cancelTimer(roomId, phase);
    }

    this.logger.log(`Timer started for room ${key}:/${duration}ms`);
    const stop$ = new Subject<void>();
    this.stopSubjects.set(key, stop$);

    return timer(duration).pipe(
      takeUntil(stop$),
      map(() => {
        this.stopSubjects.delete(key); // 타이머 완료 후 삭제
        this.logger.log(`Timer expired for ${key}`);
      }),
    ); // stop$이 방출되면 타이머 취소
  }

  /**
   * 타이머 취소
   * @param roomId - 게임 방 ID
   * @param phase - 취소할 타이머 종류 (예: 'day', 'night', 'vote')
   */
  cancelTimer(roomId: string, phase: string) {
    const key = `${roomId}:${phase}`;
    if (this.stopSubjects.has(key)) {
      const stop$ = this.stopSubjects.get(key)!; // non-null assertion 연산자 추가
      stop$.next(); // 타이머 스트림 종료
      stop$.complete();
      this.stopSubjects.delete(key);
      this.logger.log(`Timer canceled for ${key}`);
    } else {
      this.logger.warn(`No timer found for ${key}`);
    }
  }
  hasTimer(roomId: string, phase: string): boolean {
    const key = `${roomId}:${phase}`;
    return this.stopSubjects.has(key);
  }
}
