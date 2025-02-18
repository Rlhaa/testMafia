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
    private readonly redisClient: Redis, // Redis 클라이언트 주입
  ) {}

  // getRoomInfo
  // - 주어진 roomId의 방 정보를 Redis에서 조회하여 객체 형태로 반환합니다.
  async getRoomInfo(roomId: string): Promise<any> {
    if (!roomId) {
      throw new BadRequestException('roomId가 필요합니다.');
    }
    const redisKey = `room:${roomId}`; // Redis 키 생성
    const roomData = await this.redisClient.hgetall(redisKey); // Redis 해시 조회
    if (!roomData || Object.keys(roomData).length === 0) {
      throw new NotFoundException(`Room ${roomId} not found`);
    }
    return {
      id: roomData.id, // 방 ID
      hostId: roomData.hostId, // 호스트 ID
      roomName: roomData.roomName, // 방 이름
      status: roomData.status, // 방 상태
      mode: roomData.mode, // 방 모드
      locked: roomData.locked === 'true', // 문자열 -> boolean 변환
      password: roomData.password, // 방 비밀번호
      createdAt: roomData.createdAt, // 생성일
      players: roomData.players, // 플레이어 목록 (JSON 문자열)
    };
  }

  // updateRoomPlayers
  // - 플레이어 목록 배열을 JSON 문자열로 변환하여 Redis에 저장합니다.
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

  // addPlayer
  // - 주어진 roomId에 새 플레이어를 추가합니다.
  // - 최대 8명 제한을 적용하며, 중복 추가를 방지합니다.
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
