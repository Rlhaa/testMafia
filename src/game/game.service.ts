import { Injectable, BadRequestException, Inject } from '@nestjs/common';
import { Redis } from 'ioredis';
import { v4 as uuidv4 } from 'uuid';

interface FirstVote {
  voterId: number;
  targetId: number; // 투표 대상의 ID
}

interface SecondVote {
  voterId: number;
  execute: boolean; // true: 대상 실행, false: 대상 생존 선택
}

interface Player {
  id: number;
  role?: string;
  isAlive?: boolean;
}

@Injectable()
export class GameService {
  constructor(
    @Inject('REDIS_CLIENT')
    private readonly redisClient: Redis, // Redis 클라이언트 주입
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

    // 플레이어 빈 배열 생성 후
    let players = [];
    if (roomPlayersData) {
      try {
        // 저장된 플레이어 목록을 JSON으로 파싱
        players = JSON.parse(roomPlayersData);
      } catch (error) {
        players = [];
      }
    }

    // 초기 게임 상태 구성
    const initialGameState = {
      day: '0',
      phase: 'morning',
      mafiaCount: '2',
      citizenCount: '6',
      firstVote: JSON.stringify([]),
      secondVote: JSON.stringify([]),
      targetId: JSON.stringify([]),
      players: JSON.stringify(players), // 이전에 파싱한 플레이어 목록 반영
    };

    // 첫 시작 단계에서의 정보 레디스에 저장
    await this.redisClient.hmset(redisKey, initialGameState); // 초기 상태 저장
    return gameId; // 게임 ID 반환
  }

  // getGameData
  // - Redis에서 게임 데이터를 조회하고, JSON 파싱된 플레이어 목록을 반환합니다.
  async getGameData(roomId: string, gameId: string): Promise<any> {
    // 인자 예외 처리
    if (!roomId || !gameId) {
      throw new BadRequestException('roomId와 gameId가 필요합니다.');
    }
    // 들어온 인자로 redis key 구성 후
    const redisKey = `room:${roomId}:game:${gameId}`; // Redis 키 생성
    // 레디스 서버에 해당 키의 게임이 존재하는지 조회
    const gameData = await this.redisClient.hgetall(redisKey); // 게임 데이터 조회
    // 없을 때 예외처리
    if (!gameData || Object.keys(gameData).length === 0) {
      throw new BadRequestException('해당 게임 데이터가 존재하지 않습니다.');
    }
    // players 필드에 JSON 파싱을 수행하여 배열로 변환
    gameData.players = gameData.players ? JSON.parse(gameData.players) : [];
    // 게임 데이터 반환
    return gameData;
  }

  // assignRoles
  // - 방의 플레이어 수가 8명인지 확인한 후, 고정 역할 풀을 무작위로 섞어 각 플레이어에게 역할을 할당합니다.
  // - 역할 분배가 완료되면 업데이트된 플레이어 목록과 게임 phase 정보를 Redis에 저장하고, 업데이트된 배열을 반환합니다.
  async assignRoles(roomId: string, gameId: string): Promise<any> {
    // 들어온 인자로 redis key 구성 후
    const redisKey = `room:${roomId}:game:${gameId}`; // Redis 키 생성
    // getGameData 메서드를 통해 현재 게임 정보 조회
    const gameData = await this.getGameData(roomId, gameId); // 게임 데이터 조회
    // 메서드에서 반환된 게임 정보 중 players 배열을 players에 할당
    const players = gameData.players;
    const requiredPlayers = 8;
    console.log('플레이어 수:', players.length);
    // players와 requiredPlayers 비교
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

    // 각 플레이어 객체와 해당 객체의 인덱스가 콜백 함수의 매개변수로 전달
    const updatedPlayers = players.map((player, index) => ({
      // 콜백함수 내부
      // 스프레드 연산자로 객체 전개하여 새로운 객체 배열 생성
      ...player,
      // 그 객체에 할당 >> 모든 플렝이어에서 무작위로 섞은 직업이 분배
      role: rolesPool[index], // 역할 할당
      isAlive: true, // 초기 생존 상태 true 설정
    }));
    // console.log('Updated Players:', updatedPlayers);

    // 역할 부여 후 redis에 업데이트
    await this.redisClient.hset(
      redisKey,
      'players',
      JSON.stringify(updatedPlayers),
    ); // 업데이트된 플레이어 목록 저장
    // 게임 페이즈 업데이트
    await this.redisClient.hset(redisKey, 'phase', 'rolesAssigned'); // 게임 phase 업데이트

    return updatedPlayers; // 업데이트된 배열 반환
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
