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
      locked: roomData.locked === 'true',
      password: roomData.password,
      createdAt: roomData.createdAt,
      players: roomData.players, // JSON 문자열로 저장됨
    };
  }

  // 방의 플레이어 목록을 업데이트 (players 배열을 JSON 문자열로 저장)
  async updateRoomPlayers(
    roomId: string,
    players: { id: number }[],
  ): Promise<void> {
    if (!roomId) {
      throw new BadRequestException('roomId가 필요합니다.');
    }
    const redisKey = `room:${roomId}`;
    await this.redisClient.hset(redisKey, 'players', JSON.stringify(players));
  }

  // 방에 플레이어 추가 (최대 8명 제한)
  async addPlayer(
    roomId: string,
    newPlayer: { id: number },
  ): Promise<{ id: number }[]> {
    const roomData = await this.getRoomInfo(roomId);
    let players: { id: number }[] = [];
    try {
      players = roomData.players ? JSON.parse(roomData.players) : [];
    } catch (error) {
      players = [];
    }
    if (players.length >= 8) {
      throw new BadRequestException('방 최대 인원에 도달했습니다.');
    }
    // 중복 추가 방지
    if (!players.find((p) => p.id === newPlayer.id)) {
      players.push(newPlayer);
    }
    await this.updateRoomPlayers(roomId, players);
    return players;
  }
}
