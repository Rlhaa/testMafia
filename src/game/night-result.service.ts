import { Injectable } from '@nestjs/common';
import { RoomGateway } from './../room/room.gateway';

@Injectable()
export class NightResultService {
  constructor(private readonly roomGateway: RoomGateway) {}

  /**
   * 밤 결과를 클라이언트에 공지 전파
   */
  announceNightResult(
    roomId: string,
    nightNumber: number,
    result: { killedUserId: string | null; details: string },
  ): void {
    const message = `밤 동안의 사건 결과: ${result.details}`;
    const payload = { nightNumber, result, message };

    // RoomGateway를 이용해 클라이언트에 전파
    this.roomGateway.broadcastNotice(roomId, 'night_result', message, payload);
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
}
