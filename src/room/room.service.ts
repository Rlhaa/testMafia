// src/rooms/room.service.ts
import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Redis } from 'ioredis';
import { Inject } from '@nestjs/common';

@Injectable()
export class RoomService {
  constructor(
    @Inject('REDIS_CLIENT')
    private readonly redisClient: Redis,
  ) {}

  // Redis에서 특정 roomId의 방 정보를 조회합니다.

  async getRoomInfo(roomId: string): Promise<any> {
    if (!roomId) {
      throw new BadRequestException('roomId가 필요합니다.');
    }
    const redisKey = `room:${roomId}`;
    const roomData = await this.redisClient.hgetall(redisKey);
    if (!roomData || Object.keys(roomData).length === 0) {
      throw new NotFoundException(`Room ${roomId} not found`);
    }
    return {
      id: roomData.id,
      hostId: roomData.hostId,
      roomName: roomData.roomName,
      status: roomData.status,
      mode: roomData.mode,
      locked: roomData.locked === 'true', // 문자열로 저장되므로 변환
      password: roomData.password,
      createdAt: roomData.createdAt,
    };
  }
}
