// src/rooms/room.service.ts
import { Injectable } from '@nestjs/common';

@Injectable()
export class RoomService {
  // 실제로 Redis나 DB를 사용할 수 있지만, 여기서는 테스트용 간단 예시로 작성합니다.
  getRoomInfo(roomId: string): any {
    return {
      id: roomId,
      roomName: '초보만',
      status: '진행 중',
      mode: '8인 모드',
      locked: false,
      createdAt: '2025-02-17',
    };
  }
}
