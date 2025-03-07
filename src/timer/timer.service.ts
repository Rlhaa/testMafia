import { Injectable, Logger } from '@nestjs/common';
import { Observable, Subject, timer, interval } from 'rxjs';
import { map, takeUntil, tap } from 'rxjs/operators';

@Injectable()
export class TimerService {
  private readonly logger = new Logger(TimerService.name);
  private stopSubjects: Map<string, Subject<void>> = new Map(); // 타이머 취소용 Subject
  private timerStates: Map<string, boolean> = new Map(); // 타이머 상태를 저장하는 Map 추가

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
  ): Observable<number> {
    //숫자에 대해 반환하도록 변경
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

    this.timerStates.set(key, false); // 타이머 상태 초기화
    const endTime = Date.now() + duration; // 종료 시간 계산

    return interval(1000).pipe(
      // 1초마다 이벤트 발생
      takeUntil(stop$), // 취소 신호가 오면 중단
      takeUntil(timer(duration)), // duration 시간이 지나면 중단
      map(() => {
        const remainingTime = Math.max(
          0,
          Math.round((endTime - Date.now()) / 1000),
        ); // 초 단위 변환
        this.logger.log(
          `Timer tick for room ${key}: remaining ${remainingTime} seconds`,
        );

        if (remainingTime === 0) {
          this.stopSubjects.delete(key); // 타이머 완료 후 삭제
          this.timerStates.set(key, true); // 타이머 완료 상태 설정
          this.logger.log(`Timer expired for room ${key}`);
        }

        return remainingTime; // 🔥 남은 시간 반환
      }),
    );
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
      this.stopSubjects.delete(key);
      this.logger.log(`Timer canceled for room ${key}`);
    } else {
      this.logger.warn(`No timer found for room ${key}`);
    }
  }
  hasTimer(roomId: string, phase: string): boolean {
    const key = `${roomId}:${phase}`;
    return this.stopSubjects.has(key);
  }
  getTimerCompleted(roomId: string, phase: string): boolean {
    const key = `${roomId}:${phase}`;
    return this.timerStates.get(key) || false; // 타이머 상태 반환, 없으면 false 반환
  }
}
