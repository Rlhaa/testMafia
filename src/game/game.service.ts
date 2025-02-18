import { Injectable, BadRequestException, Inject } from '@nestjs/common';
import { Redis } from 'ioredis';
import { v4 as uuidv4 } from 'uuid';

// 서비스 파일에서는 게임, 룸 관련 비즈니스 로직에 집중

@Injectable()
export class GameService {
  constructor(
    @Inject('REDIS_CLIENT')
    private readonly redisClient: Redis,
  ) {}

  /**
   * createGame
   * - 새로운 게임 ID를 생성하고, 초기 게임 상태를 Redis에 저장합니다.
   * - 초기 상태에는 현재 방의 플레이어 목록(플레이어 정보는 JSON 문자열)도 반영됩니다.
   */
  async createGame(roomId: string): Promise<string> {
    if (!roomId) {
      throw new BadRequestException('roomId가 필요합니다.');
    }
    const gameId = uuidv4();
    const redisKey = `room:${roomId}:game:${gameId}`;
    console.log(gameId);
    console.log(redisKey);

    // 방에 저장된 플레이어 목록 가져오기
    const roomPlayersData = await this.redisClient.hget(
      `room:${roomId}`,
      'players',
    );
    let players = [];
    if (roomPlayersData) {
      try {
        players = JSON.parse(roomPlayersData);
      } catch (error) {
        players = [];
      }
    }

    const initialGameState = {
      day: '1',
      phase: 'morning',
      mafiaCount: '2',
      citizenCount: '6',
      firstVote: JSON.stringify([]),
      secondVote: JSON.stringify([]),
      targetId: JSON.stringify([]),
      players: JSON.stringify(players), // 플레이어 목록 반영
    };

    await this.redisClient.hmset(redisKey, initialGameState);
    return gameId;
  }

  /**
   * getGameData
   * - Redis에서 게임 데이터를 조회합니다.
   */
  async getGameData(roomId: string, gameId: string): Promise<any> {
    if (!roomId || !gameId) {
      throw new BadRequestException('roomId와 gameId가 필요합니다.');
    }
    const redisKey = `room:${roomId}:game:${gameId}`;
    const gameData = await this.redisClient.hgetall(redisKey);
    if (!gameData || Object.keys(gameData).length === 0) {
      throw new BadRequestException('해당 게임 데이터가 존재하지 않습니다.');
    }
    gameData.players = gameData.players ? JSON.parse(gameData.players) : [];
    return gameData;
  }

  /**
   * assignRoles
   * - 플레이어 수가 8명인지 확인한 후, 고정 역할 풀을 무작위로 섞어 각 플레이어에게 할당합니다.
   * - 역할 분배가 완료되면 업데이트된 플레이어 목록과 phase 정보를 Redis에 저장합니다.
   */
  async assignRoles(roomId: string, gameId: string): Promise<any> {
    const redisKey = `room:${roomId}:game:${gameId}`;
    const gameData = await this.getGameData(roomId, gameId);
    const players = gameData.players;
    const requiredPlayers = 8;
    console.log(players.length);
    if (players.length !== requiredPlayers) {
      throw new BadRequestException(
        '플레이어 수가 부족하여 역할 분배를 진행할 수 없습니다.',
      );
    }

    // 고정 역할 풀 (순서: mafia 2, citizen 4, police 1, doctor 1)
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
    rolesPool.sort(() => Math.random() - 0.5);

    const updatedPlayers = players.map((player, index) => ({
      ...player,
      role: rolesPool[index],
      isAlive: true,
    }));
    console.log(updatedPlayers);

    await this.redisClient.hset(
      redisKey,
      'players',
      JSON.stringify(updatedPlayers),
    );
    await this.redisClient.hset(redisKey, 'phase', 'rolesAssigned');

    return updatedPlayers;
  }
}
