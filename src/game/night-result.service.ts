import { Injectable } from '@nestjs/common';
import { RoomGateway } from './../room/room.gateway';

@Injectable()
export class NightResultService {
  constructor(private readonly roomGateway: RoomGateway) {}

  // 기본 시스템 공지 함수
  announceSystemMessage(
    roomId: string,
    message: string,
    additionalData?: Record<string, any>,
  ): void {
    this.roomGateway.broadcastNotice(
      roomId,
      'system_message',
      message,
      additionalData,
    );
  }

  announceNightResult(
    roomId: string,
    nightNumber: number,
    result: { killedUserId: string | null; details: string },
  ): void {
    const message = `밤 동안의 사건 결과: ${result.details}`;
    this.roomGateway.broadcastNotice(roomId, 'night_result', message, {
      nightNumber,
      result,
    });
  }

  announceDayStart(roomId: string, dayNumber: number): void {
    const message = `낮이 되었습니다. ${dayNumber}번째 낮`;
    this.roomGateway.broadcastNotice(roomId, 'day_start', message, {
      dayNumber,
    });
  }

  announceGameRestart(roomId: string): void {
    const message = '다시 시작되었습니다.';
    this.roomGateway.broadcastNotice(roomId, 'game_restart', message);
  }

  announcePoliceAction(roomId: string, userId: string): void {
    const message = `경찰이 능력을 사용했습니다: ${userId}`;
    this.roomGateway.broadcastNotice(roomId, 'police_action', message, {
      userId,
    });
  }

  announceDoctorAction(roomId: string, savedUserId: string): void {
    const message = `의사가 플레이어를 살렸습니다: ${savedUserId}`;
    this.roomGateway.broadcastNotice(roomId, 'doctor_action', message, {
      savedUserId,
    });
  }

  announceMafiaAction(roomId: string, targetUserId: string): void {
    const message = `마피아가 플레이어를 죽였습니다: ${targetUserId}`;
    this.roomGateway.broadcastNotice(roomId, 'mafia_action', message, {
      targetUserId,
    });
  }

  announceMorning(roomId: string, morningNumber: number): void {
    const message = `${morningNumber}번째 아침이 시작됩니다.`;
    this.roomGateway.broadcastNotice(roomId, 'morning_start', message, {
      morningNumber,
    });
  }

  // 추가된 시스템 공지 함수들
  announceJoinRoom(roomId: string, userId: number): void {
    const message = `${userId}번 유저가 ${roomId}번 방에 접속하였습니다.`;
    this.announceSystemMessage(roomId, message);
  }

  announceRoomFull(roomId: string): void {
    const message = '방이 꽉 찼습니다. 10초 후 게임이 시작됩니다.';
    this.announceSystemMessage(roomId, message);
  }

  announceLeaveRoom(roomId: string, userId: number): void {
    const message = `${userId}번 유저가 ${roomId}번 방에서 나갔습니다.`;
    this.announceSystemMessage(roomId, message);
  }

  announceCancelTimer(roomId: string): void {
    const message = '인원이 줄어들어 게임 시작 타이머가 취소되었습니다.';
    this.announceSystemMessage(roomId, message);
  }
}
