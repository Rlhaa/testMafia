import { Injectable, BadRequestException, Inject } from '@nestjs/common';
import { Redis } from 'ioredis';
import { v4 as uuidv4 } from 'uuid';

<<<<<<< Updated upstream
interface FirstVote {
=======
// 투표, 플레이어 인터페이스 정의
export interface FirstVote {
>>>>>>> Stashed changes
  voterId: number;
  targetId: number; // 투표 대상의 ID
}

<<<<<<< Updated upstream
interface SecondVote {
=======
export interface SecondVote {
>>>>>>> Stashed changes
  voterId: number;
  execute: boolean; // true: 대상 실행, false: 대상 생존 선택
}

<<<<<<< Updated upstream
interface Player {
=======
export interface Player {
>>>>>>> Stashed changes
  id: number;
  role?: string;
  isAlive?: boolean;
}

@Injectable()
export class GameService {
  constructor(
    @Inject('REDIS_CLIENT')
    private readonly redisClient: Redis, // ioredis 클라이언트 주입 (로컬 또는 Elasticache Redis)
  ) {}

  // createGame
  // - 새로운 게임 ID를 생성하고, 초기 게임 상태를 Redis에 저장합니다.
  // - 초기 상태에는 현재 방의 플레이어 목록(플레이어 정보는 JSON 문자열)도 포함됩니다.
  async createGame(roomId: string): Promise<string> {
    if (!roomId) {
      throw new BadRequestException('roomId가 필요합니다.');
    }
    const gameId = uuidv4(); // 고유 게임 ID 생성
    const redisKey = `room:${roomId}:game:${gameId}`; // Redis 키 생성
    console.log('Game ID:', gameId);
    console.log('Redis Key:', redisKey);

    // 방에 저장된 플레이어 목록 가져오기
    const roomPlayersData = await this.redisClient.hget(
      `room:${roomId}`,
      'players',
    );

<<<<<<< Updated upstream
    // 플레이어 빈 배열 생성 후
    let players = [];
=======
    let players: Player[] = [];
>>>>>>> Stashed changes
    if (roomPlayersData) {
      try {
        // 저장된 플레이어 목록을 JSON으로 파싱
        players = JSON.parse(roomPlayersData);
      } catch (error) {
        players = [];
      }
    }

<<<<<<< Updated upstream
    // 초기 게임 상태 구성
    const initialGameState = {
=======
    // 초기 게임 상태 구성 (모든 값은 문자열이어야 함)
    const initialGameState: Record<string, string> = {
>>>>>>> Stashed changes
      day: '0',
      phase: 'morning',
      mafiaCount: '2',
      citizenCount: '6',
      firstVote: JSON.stringify([]),
      secondVote: JSON.stringify([]),
      targetId: JSON.stringify([]),
      players: JSON.stringify(players), // 이전에 파싱한 플레이어 목록 반영
    };

    // 각 필드를 개별적으로 저장 (hset(key, field, value))
    await Promise.all(
      Object.entries(initialGameState).map(([field, value]) =>
        this.redisClient.hset(redisKey, field, value),
      ),
    );

    return gameId; // 게임 ID 반환
  }

  // getGameData
  // - Redis에서 게임 데이터를 조회하고, JSON 파싱된 플레이어 목록을 반환합니다.
  async getGameData(roomId: string, gameId: string): Promise<any> {
    if (!roomId || !gameId) {
      throw new BadRequestException('roomId와 gameId가 필요합니다.');
    }
    const redisKey = `room:${roomId}:game:${gameId}`; // Redis 키 생성
    const gameData = (await this.redisClient.hgetall(redisKey)) || {};
    if (Object.keys(gameData).length === 0) {
      throw new BadRequestException('해당 게임 데이터가 존재하지 않습니다.');
    }
    // players 필드를 JSON 파싱하여 배열로 변환
    gameData.players = gameData.players ? JSON.parse(gameData.players) : [];
    return gameData;
  }

  // assignRoles
  // - 방의 플레이어 수가 8명인지 확인한 후, 고정 역할 풀을 무작위로 섞어 각 플레이어에게 역할을 할당합니다.
  // - 역할 분배가 완료되면 업데이트된 플레이어 목록과 게임 phase 정보를 Redis에 저장하고, 업데이트된 배열을 반환합니다.
  async assignRoles(roomId: string, gameId: string): Promise<Player[]> {
    const redisKey = `room:${roomId}:game:${gameId}`; // Redis 키 생성
    const gameData = await this.getGameData(roomId, gameId); // 게임 데이터 조회
    const players: Player[] = gameData.players;
    const requiredPlayers = 8;
    console.log('플레이어 수:', players.length);
    if (players.length !== requiredPlayers) {
      throw new BadRequestException(
        '플레이어 수가 8인이 아니므로 역할 분배를 진행할 수 없습니다.',
      );
    }

    // 고정된 역할 풀: mafia 2, citizen 4, police 1, doctor 1
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
    rolesPool.sort(() => Math.random() - 0.5); // 역할 풀 무작위 순서로 섞기

    const updatedPlayers = players.map((player, index) => ({
      ...player, // 기존 플레이어 데이터 전개
      role: rolesPool[index], // 역할 할당
      isAlive: true, // 초기 생존 상태 true 설정
    }));
    console.log('Updated Players:', updatedPlayers);

    // 각 필드를 개별적으로 저장
    await Promise.all([
      this.redisClient.hset(
        redisKey,
        'players',
        JSON.stringify(updatedPlayers),
      ),
      this.redisClient.hset(redisKey, 'phase', 'rolesAssigned'),
    ]);

    return updatedPlayers; // 업데이트된 플레이어 배열 반환
  }

  // startDayPhase
  // - 게임의 낮 단계를 시작하며, day 값을 증가시키고 phase를 "day"로 업데이트합니다.
  // - 투표 배열(firstVote, secondVote)도 초기화합니다.
  async startDayPhase(roomId: string, gameId: string): Promise<number> {
    const redisKey = `room:${roomId}:game:${gameId}`; // Redis 키 생성
    const gameData = await this.getGameData(roomId, gameId); // 게임 데이터 조회
    let currentDay = parseInt(gameData.day, 10) || 0; // 현재 day 값 변환
    currentDay += 1; // day 값 1 증가

    await Promise.all([
      this.redisClient.hset(redisKey, 'day', currentDay.toString()),
      this.redisClient.hset(redisKey, 'phase', 'day'),
      this.redisClient.hset(redisKey, 'firstVote', JSON.stringify([])),
      this.redisClient.hset(redisKey, 'secondVote', JSON.stringify([])),
    ]);

    return currentDay; // 증가된 day 반환
  }

  // processFirstVote
  // - 1차 투표를 처리합니다.
  // - 모든 살아있는 플레이어가 투표했거나, 투표 마감 시간이 지난 경우 최다 득표 대상을 반환합니다.
  async processFirstVote(
    roomId: string,
    gameId: string,
    votes: FirstVote[],
  ): Promise<number> {
    // 투표 마감 시각을 현재 시각으로부터 5분 후로 설정 (5분 = 300000ms)
    const voteDeadline = new Date(Date.now() + 5 * 60 * 1000);

    // 현재 게임 데이터를 조회
    const gameData = await this.getGameData(roomId, gameId);
    const players: Player[] = gameData.players;
    // 살아있는 플레이어만 필터링
    const alivePlayers = players.filter((player) => player.isAlive);
    const totalAlive = alivePlayers.length;

    // 모든 살아있는 플레이어가 투표하지 않았고 아직 마감 시간이 지나지 않았다면 예외 발생
    if (votes.length < totalAlive && new Date() < voteDeadline) {
      throw new BadRequestException('1차 투표가 아직 완료되지 않았습니다.');
    }

    // 각 대상에 대해 투표 수 집계
    const voteCount = new Map<number, number>();
    votes.forEach(({ targetId }) => {
      voteCount.set(targetId, (voteCount.get(targetId) || 0) + 1);
    });

    // 최다 득표 대상 결정
    let maxVotes = 0;
    let targetToVote: number | null = null;
    voteCount.forEach((count, targetId) => {
      if (count > maxVotes) {
        maxVotes = count;
        targetToVote = targetId;
      }
    });

    if (targetToVote === null) {
      throw new BadRequestException('1차 투표 결과가 유효하지 않습니다.');
    }

    return targetToVote;
  }

  async startDayPhase(roomId: string, gameId: string): Promise<void> {
    // 들어온 인자로 레디스 키 구성
    const redisKey = `room:${roomId}:game:${gameId}`;

    // 현재 게임 데이터를 get
    const gameData = await this.getGameData(roomId, gameId);

    // 현재 day 값을 숫자로 변환 (초기 상태가 "0" 또는 없을 경우 기본값 0)
    let currentDay = parseInt(gameData.day, 10) || 0;

    // day 값을 1 증가
    currentDay += 1;

    // 게임 상태 업데이트: 새로운 day와 낮 단계("day")로 설정
    await this.redisClient.hset(redisKey, 'day', currentDay.toString());
    await this.redisClient.hset(redisKey, 'phase', 'day');

    // 필요에 따라 투표 배열 초기화 (예: firstVote, secondVote)
    await this.redisClient.hset(redisKey, 'firstVote', JSON.stringify([]));
    await this.redisClient.hset(redisKey, 'secondVote', JSON.stringify([]));
  }

  async processFirstVote(
    roomId: string,
    gameId: string,
    votes: FirstVote[],
    voteDeadline: Date, // 투표 마감 시각
  ): Promise<number> {
    // 1. 현재 게임 데이터를 조회하여 전체 플레이어 목록을 가져옵니다.
    const gameData = await this.getGameData(roomId, gameId);
    const players: Player[] = gameData.players;

    // 살아있는 플레이어만 필터링
    const alivePlayers = players.filter((player) => player.isAlive);
    const totalAlive = alivePlayers.length;

    // 2. 하이브리드 조건: 아직 투표가 완료되지 않았다면 (투표 수가 살아있는 플레이어 수보다 적고, 시간이 남아있으면)
    if (votes.length < totalAlive && new Date() < voteDeadline) {
      throw new BadRequestException('1차 투표가 아직 완료되지 않았습니다.');
    }

    // 3. 투표 집계: 각 대상(targetId)에 대해 몇 표를 받았는지 계산합니다.
    const voteCount = new Map<number, number>();
    votes.forEach(({ targetId }) => {
      voteCount.set(targetId, (voteCount.get(targetId) || 0) + 1);
    });

    // 4. 최다 득표 대상 결정
    let maxVotes = 0;
    let targetToVote: number | null = null;
    voteCount.forEach((count, targetId) => {
      if (count > maxVotes) {
        maxVotes = count;
        targetToVote = targetId;
      }
    });

    if (targetToVote === null) {
      throw new BadRequestException('1차 투표 결과가 유효하지 않습니다.');
    }

    // 5. 최다 득표 대상의 ID 반환
    return targetToVote;
  }
}
