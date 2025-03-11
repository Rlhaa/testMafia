import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import {
  Observable,
  Subject,
  timer,
  interval,
  from,
  of,
  takeUntil,
  catchError,
  switchMap,
  map,
  tap,
} from 'rxjs';

@Injectable()
export class TimerService {
  private readonly logger = new Logger(TimerService.name);
  private stopSubjects: Map<string, Subject<void>> = new Map();
  private completedTimers: Map<string, boolean> = new Map(); // 타이머 완료 여부 저장

  constructor(@Inject('REDIS_CLIENT') private readonly redisClient: Redis) {}

  /**
   * 🔥 Redis 기반 타이머 시작
   */
  startTimer(
    roomId: string,
    phase: string,
    duration: number,
  ): Observable<number> {
    if (!roomId || !phase) {
      this.logger.error(
        `🚨 Invalid room ID or phase: roomId=${roomId}, phase=${phase}`,
      );
      throw new Error('Invalid room ID');
    }

    const key = `${roomId}:${phase}`;

    // 기존 타이머가 있으면 취소
    if (this.stopSubjects.has(key)) {
      this.logger.warn(
        `⚠️ Timer already running for ${key}. Cancelling existing timer.`,
      );
      this.cancelTimer(roomId, phase);
    }

    const stop$ = new Subject<void>();
    this.stopSubjects.set(key, stop$);
    this.completedTimers.set(key, false); // 타이머 시작 시 완료 여부 초기화
    stop$.subscribe(() => console.log(`🛑 stop$ emitted! ${key}`));
    this.setTimer(roomId, phase, duration / 1000)
      .catch((err) => {
        this.logger.error(`🚨 Redis setTimer error: ${err.message}`);
        this.cancelTimer(roomId, phase);
        return of(null);
      })
      .then(() => {
        this.logger.log(
          `⏳ Timer started for ${key}, duration: ${duration / 1000} seconds`,
        );
      });

    return interval(1000).pipe(
      switchMap(() => from(this.getRemainingTime(roomId, phase))),
      map((remainingTime) => {
        if (remainingTime <= 1) {
          this.completedTimers.set(key, true); // 타이머 완료 설정
          this.stopSubjects.delete(key);
          this.logger.log(`✅ Timer expired for ${roomId} (${phase})`);
        }
        return remainingTime;
      }),
      takeUntil(timer(duration)),
      takeUntil(stop$),
      catchError((err) => {
        this.logger.error(`🚨 getRemainingTime error: ${err.message}`);
        this.cancelTimer(roomId, phase);
        return of(0);
      }),
    );
  }

  /**
   * ⏹️ 타이머 취소 (Redis 키 삭제 포함)
   */
  async cancelTimer(roomId: string, phase: string) {
    const key = `${roomId}:${phase}`;
    // 메모리에 등록된 타이머가 있는 경우
    if (this.stopSubjects.has(key)) {
      const stopSubject = this.stopSubjects.get(key);
      if (stopSubject) {
        stopSubject.next();
        stopSubject.complete();
      }
      this.stopSubjects.delete(key);
    }

    // 🔥 Redis에서 키 삭제
    try {
      const remainingTime = await this.getRemainingTime(roomId, phase);
      if (remainingTime > 0) {
        await this.deleteTimer(roomId, phase);
        this.logger.warn(
          `⏹️ Timer cancelled and deleted for ${roomId} (${phase})`,
        );
      } else {
        this.logger.debug(
          `🔍 No active Redis timer found for ${roomId} (${phase}), skipping deletion.`,
        );
      }
    } catch (err) {
      this.logger.error(`🚨 Redis deleteTimer error: ${err.message}`);
    }
  }

  /**
   * 🔎 타이머 존재 여부 확인
   */
  async hasTimer(roomId: string, phase: string): Promise<boolean> {
    const key = `${roomId}:${phase}`;

    if (this.stopSubjects.has(key)) {
      this.logger.debug(`✅ Timer exists in memory for ${roomId} (${phase})`);
      return true;
    }

    try {
      const remainingTime = await this.getRemainingTime(roomId, phase);
      return remainingTime > 0;
    } catch (err) {
      this.logger.error(`🚨 hasTimer getRemainingTime error: ${err.message}`);
      return false;
    }
  }

  /**
   * 🔥 Redis에 타이머 저장 (TTL 설정)
   */
  async setTimer(
    roomId: string,
    phase: string,
    duration: number,
  ): Promise<void> {
    const key = `timer:${roomId}:${phase}`;
    await this.redisClient.setex(key, duration, 'running');
    this.logger.log(
      `📌 Redis timer set: ${key}, duration: ${duration} seconds`,
    );
  }

  /**
   * ⏳ Redis에서 남은 시간 가져오기
   */
  async getRemainingTime(roomId: string, phase: string): Promise<number> {
    const key = `timer:${roomId}:${phase}`;
    const ttl = await this.redisClient.ttl(key);
    this.logger.debug(`🔍 Redis TTL for ${key}: ${ttl} seconds`);

    if (ttl === -2) {
      this.logger.warn(`🚨 Redis key ${key} not found.`);
      return 0;
    }

    return ttl > 0 ? ttl : 0;
  }

  /**
   * 🗑️ Redis에서 타이머 삭제
   */
  async deleteTimer(roomId: string, phase: string): Promise<void> {
    const key = `timer:${roomId}:${phase}`;
    await this.redisClient.del(key);
    this.logger.log(`🗑️ Redis timer deleted: ${key}`);
  }

  /**
   * 타이머 완료 여부 확인
   */
  getTimerCompleted(roomId: string, phase: string): boolean {
    const key = `${roomId}:${phase}`;
    const completeKey = this.completedTimers.get(key);
    console.log(completeKey);
    return typeof completeKey === 'boolean' ? completeKey : false;
  }
}
