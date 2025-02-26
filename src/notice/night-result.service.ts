import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { RoomGateway } from 'src/room/room.gateway';
import { Player } from 'src/game/game.service';

@Injectable()
export class NightResultService {
  constructor(
    @Inject(forwardRef(() => RoomGateway))
    private readonly roomGateway: RoomGateway,
  ) {}

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
  // 여기는 임의로 만들어 놓은 예시여서 데이터 값을 맞게 넣어주시면 됩니다.
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
  //낮 공지는 지금 룸 서비스에서 전부 다 한번에 진행되서 그냥 놔둠 예시
  announceDayStart(roomId: string, dayNumber: number): void {
    const message = `낮이 되었습니다. ${dayNumber}번째 낮`;
    this.roomGateway.broadcastNotice(roomId, 'day_start', message, {
      dayNumber,
    });
  }

  announceFirstVoteStart(roomId: string, dayNumber: number): void {
    const message = `${dayNumber}번째 낮 대상자 투표가 시작 되었습니다., 15초 후 마감 됩니다.`;
    this.announceSystemMessage(roomId, message);
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

  // 추가된 시스템 공지 함수들 이건 룸 서비스 기본 코드 토대로 만들었습니다.
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

  // 밤 시작을 클라이언트에 알리는 함수
  announceNightStart(roomId: string, mafias: Player[], dead: Player[]): void {
    const message = `밤이 시작되었습니다.`;
    this.roomGateway.broadcastNotice(roomId, 'night_start', message, {
      mafias,
      dead,
    });
  }

  //
}

// // GameService에서 새로 호출하는 공지 함수들 아직 정확하게 이해를 하지 못했습니다.

// announceGameCreated(roomId: string, gameId: string): void {
//   const message = `게임이 생성되었습니다. 게임 ID: ${gameId}`;
//   this.roomGateway.broadcastNotice(roomId, 'game_created', message, {
//     gameId,
//   });
// }

// announceRolesAssigned(
//   roomId: string,
//   gameId: string,
//   players: Player[],
// ): void {
//   const message = `역할이 분배되었습니다.`;
//   // 주의: 실제 게임에서는 플레이어의 역할 정보가 공개되면 안 될 수 있음
//   this.roomGateway.broadcastNotice(roomId, 'roles_assigned', message, {
//     gameId,
//     players,
//   });
// }

// announceVoteResult(
//   roomId: string,
//   gameId: string,
//   voteResult: { winnerId: number | null; voteCount: number },
// ): void {
//   let message = '';
//   if (voteResult.winnerId !== null) {
//     message = `투표 결과: ${voteResult.winnerId}번 플레이어가 처형됩니다. (득표수: ${voteResult.voteCount})`;
//   } else {
//     message = `투표 결과가 동점입니다.`;
//   }
//   this.roomGateway.broadcastNotice(roomId, 'vote_result', message, {
//     gameId,
//     voteResult,
//   });
// }

// sendNightResult(roomId: string, gameId: string, nightResult: any): void {
//   // nightResult는 message 프로퍼티를 포함하는 객체라고 가정합니다.
//   this.roomGateway.broadcastNotice(
//     roomId,
//     'night_result',
//     nightResult.message,
//     { gameId, nightResult },
//   );
// }
