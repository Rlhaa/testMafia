// src/game/game.service.ts
import { Injectable, BadRequestException, Inject } from '@nestjs/common';
import { Redis } from 'ioredis';

@Injectable()
export class GameService {
  constructor(
    @Inject('REDIS_CLIENT')
    private readonly redisClient: Redis,
  ) {}
  // 클라이언트가 ROOM:GAME_START 이벤트를 보낼 때, 이벤트 페이로드에 roomId와 gameId를 함께 전달한다고 가정

  //  Redis에서 게임 데이터를 조회합니다.
  //  게임 데이터는 키 `room:{roomId}:game:{gameId}` 에 저장되어 있으며,
  //  players 필드는 JSON 문자열로 저장되어 있다고 가정합니다.

  async getGameData(roomId: string, gameId: string): Promise<any> {
    if (!roomId || !gameId) {
      throw new BadRequestException('roomId와 gameId가 필요합니다.');
    }
    const redisKey = `room:${roomId}:game:${gameId}`;
    const gameData = await this.redisClient.hgetall(redisKey);
    if (!gameData || Object.keys(gameData).length === 0) {
      throw new BadRequestException('해당 게임 데이터가 존재하지 않습니다.');
    }
    // players 필드가 있으면 JSON 파싱 (없으면 빈 배열)
    gameData.players = gameData.players ? JSON.parse(gameData.players) : [];
    return gameData;
  }

  //  ROOM:GAME_START 이벤트 신호를 받아 역할 분배를수행
  //  게임 데이터에서 players 배열을 확인
  //  플레이어 수가 8명인지 검증
  //  고정 역할 풀(마피아 2, 시민 4, 경찰 1, 의사 1)을 무작위로 섞어 할당
  //  업데이트된 players 배열과 게임 상태를 Redis에 저장

  async assignRoles(roomId: string, gameId: string): Promise<any> {
    const redisKey = `room:${roomId}:game:${gameId}`;
    const gameData = await this.getGameData(roomId, gameId);
    const players = gameData.players;
    const requiredPlayers = 8; // 테스트 단계: 8명이 꽉 차야 시작

    if (players.length < requiredPlayers) {
      throw new BadRequestException(
        '플레이어 수가 부족하여 역할 분배를 진행할 수 없습니다.',
      );
    }

    // 고정 역할 분배: mafia 2, citizen 4, police 1, doctor 1
    const rolesPool = [
      'mafia',
      'mafia',
      'citizen',
      'citizen',
      'citizen',
      'citizen',
      'police',
      'doctor',
    ];
    rolesPool.sort(() => Math.random() - 0.5); // 무작위 섞기

    // 각 플레이어에게 역할과 초기 상태 할당
    const updatedPlayers = players.map((player, index) => ({
      ...player,
      role: rolesPool[index],
      isAlive: true,
    }));

    // Redis 업데이트: players 필드와 phase(예: 'rolesAssigned') 업데이트
    await this.redisClient.hset(
      redisKey,
      'players',
      JSON.stringify(updatedPlayers),
    );
    await this.redisClient.hset(redisKey, 'phase', 'rolesAssigned');

    return updatedPlayers;
  }
}
