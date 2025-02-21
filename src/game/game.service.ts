import { Injectable, BadRequestException, Inject } from '@nestjs/common';
import { Redis } from 'ioredis';
import { v4 as uuidv4 } from 'uuid';

// 투표, 플레이어 인터페이스 정의
export interface FirstVote {
  voterId: number;
  targetId: number; // 투표 대상의 ID
}

export interface SecondVote {
  voterId: number;
  execute: boolean; // true: 대상 실행, false: 대상 생존 선택
}

export interface Player {
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

  // 1. 첫번쨰 게임 생성 단계
  // 새로운 게임을 초기 세팅 값 기준으로 생성하고 레디스에 저장
  async createGame(roomId: string): Promise<void> {
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

    let players: Player[] = [];
    if (roomPlayersData) {
      try {
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
      players: JSON.stringify(players),
    };

    // 레디스에 게임 데이터 저장
    await Promise.all(
      Object.entries(initialGameState).map(([field, value]) =>
        this.redisClient.hset(redisKey, field, value),
      ),
    );

    // 현재 방에 진행 중인 게임 ID 저장
    await this.redisClient.set(`room:${roomId}:currentGameId`, gameId);

    console.log(`게임 ID ${gameId}가 방 ${roomId}에 저장되었습니다.`);
  }

  // 2. 게임 데이터 조회 단계
  // 특정 게임의 데이터를 레딧스에서 조회
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

  // 3. 현재 진해중인 게임 ID 조회 시
  // 현재 방에서 진행중인 게임의 ID를 가져오거나
  async getCurrentGameId(roomId: string): Promise<string | null> {
    // 현재 진행 중인 게임 ID 가져오기
    const gameId = await this.redisClient.get(`room:${roomId}:currentGameId`);
    if (gameId) {
      return gameId;
    }

    // ===== 백업부분 =====
    console.log(`room:${roomId}:currentGameId 키가 없음. 게임 ID 검색 중...`);

    // `room:{roomId}:game:*` 패턴으로 게임 ID 검색 (백업 방법)
    const keys = await this.redisClient.keys(`room:${roomId}:game:*`);

    if (keys.length === 0) return null;

    // 키의 형식이 room:{roomId}:game:{gameId}이므로 마지막 부분이 gameId
    const foundGameId = keys[0].split(':').pop() || null;

    if (foundGameId) {
      // 다시 `currentGameId`를 저장하여 빠르게 접근 가능하도록 함
      await this.redisClient.set(`room:${roomId}:currentGameId`, foundGameId);
      console.log(`room:${roomId}의 현재 게임 ID를 복구: ${foundGameId}`);
    }

    return foundGameId;
    // ===== 백업부분 =====
  }

  // 4. 역할 분배 단계
  //  게임이 시작될 때 플레이어 수가 8명인지 확인한 후, 고정 역할 풀을 무작위로 섞어 각 플레이어에게 역할을 할당
  //  역할 분배가 완료되면 업데이트된 플레이어 목록과 게임 phase 정보를 Redis에 저장하고, 업데이트된 배열을 반환
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

    return updatedPlayers; // 역할 분배 완료된 플레이어 배열 반환
  }

  //  5. 낮 시작 단계
  //  게임의 낮 단계를 시작하고 투표를 초기화
  async startDayPhase(roomId: string, gameId: string): Promise<number> {
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

    return currentDay;
  }

  async handleFirstVoteProcess(
    roomId: string,
    voterId: number,
    targetId: number,
  ) {
    console.log(
      `handleFirstVoteProcess 요청 - roomId: ${roomId}, voterId: ${voterId}, targetId: ${targetId}`,
    );

    const gameId = await this.getCurrentGameId(roomId);
    if (!gameId) {
      console.error(`room:${roomId}:currentGameId 키를 찾을 수 없습니다.`);
      throw new BadRequestException('현재 진행 중인 게임이 존재하지 않습니다.');
    }

    console.log(`현재 진행 중인 게임 ID: ${gameId}`);

    //  자기 자신에게 투표하는 것 방지
    if (voterId === targetId) {
      console.warn(`사용자 ${voterId}가 자기 자신에게 투표하려고 시도함.`);
      return { success: false, message: '자기 자신에게는 투표할 수 없습니다.' };
    }

    const firstVoteKey = `room:${roomId}:game:${gameId}:firstVote`;
    const votes = await this.redisClient.get(firstVoteKey);
    let voteArray: { voterId: number; targetId: number }[] = votes
      ? JSON.parse(votes)
      : [];

    //  중복 투표 방지
    if (voteArray.some((vote) => vote.voterId === voterId)) {
      return { success: false, message: '이미 투표하셨습니다.' };
    }

    //  투표 정보 추가
    voteArray.push({ voterId, targetId });
    await this.redisClient.set(firstVoteKey, JSON.stringify(voteArray));

    //  현재 투표 현황 조회
    const playersData = await this.redisClient.get(
      `room:${roomId}:game:${gameId}:players`,
    );
    const players = playersData ? JSON.parse(playersData) : [];
    const alivePlayers = players.filter((player: any) => player.isAlive).length;

    //  모든 플레이어가 투표 완료했는지 확인
    let finalResult: { winnerId: number | null; voteCount: number } = {
      winnerId: null,
      voteCount: 0,
    };
    let allVotesCompleted = false;
    if (voteArray.length === alivePlayers) {
      allVotesCompleted = true;
      finalResult = (await this.calculateVoteResult(roomId)) || {
        winnerId: null,
        voteCount: 0,
      };
    }

    return {
      success: true,
      voteData: voteArray,
      allVotesCompleted,
      finalResult,
    };
  }

  // 1차 투표 결과 집계
  async calculateVoteResult(
    roomId: string,
  ): Promise<{ winnerId: number | null; voteCount: number }> {
    const gameId = await this.redisClient.get(`room:${roomId}:currentGameId`);
    if (!gameId) {
      throw new BadRequestException('현재 진행 중인 게임이 존재하지 않습니다.');
    }

    const firstVoteKey = `room:${roomId}:game:${gameId}:firstVote`;

    const votes = await this.redisClient.get(firstVoteKey);
    if (!votes) {
      return { winnerId: null, voteCount: 0 }; // 기본값 반환
    }

    const voteArray: { voterId: number; targetId: number }[] =
      JSON.parse(votes);
    const voteCount: Record<number, number> = {};

    voteArray.forEach((vote) => {
      voteCount[vote.targetId] = (voteCount[vote.targetId] || 0) + 1;
    });

    // 최다 득표자 판별
    let maxVotes = 0;
    let candidates: number[] = [];
    Object.entries(voteCount).forEach(([targetId, count]) => {
      if (count > maxVotes) {
        maxVotes = count;
        candidates = [Number(targetId)];
      } else if (count === maxVotes) {
        candidates.push(Number(targetId));
      }
    });

    return {
      winnerId: candidates.length === 1 ? candidates[0] : null,
      voteCount: maxVotes,
    };
  }

  //n. 밤 시작
  //2차례의 투표 종료 후 15초간 밤이 됩니다.
  //마피아는 의논 후에 사살 대상을 선택할 수 있고
  //의사는 살릴 사람을 선택할 수 있고
  //경찰은 조사 대상을 선택할 수 있습니다.
  //getMafias
  //마피아를 배정받은 사람들을 구합니다.
  //마피아끼리 대화할 때 메세지를 이들에게 전송합니다.
  async startNightPhase(roomId: string, gameId: string): Promise<number> {
    // 들어온 인자로 레디스 키 구성
    const redisKey = `room:${roomId}:game:${gameId}`;
    // 현재 게임 데이터를 get
    const gameData = await this.getGameData(roomId, gameId);

    // 현재 day 값을 숫자로 변환 (초기 상태가 "0" 또는 없을 경우 기본값 0)
    let currentDay = parseInt(gameData.day, 10) || 0;
    await this.redisClient.hset(redisKey, 'phase', 'night');
    return currentDay;
  }

  //수신자: 마피아
  async getMafias(roomId: string, gameId: string) {
    const gameData = await this.getGameData(roomId, gameId); // 게임 데이터 조회
    const players: Player[] = gameData.players;

    // 마피아인 플레이어만 필터링합니다.
    const mafias = players.filter((player) => player.role === 'mafia');

    return mafias;
  }

  //수신자: 시체
  async getDead(roomId: string, gameId: string) {
    const gameData = await this.getGameData(roomId, gameId); // 게임 데이터 조회
    const players: Player[] = gameData.players;

    // 죽은 사람을 검색
    const dead = players.filter((player) => player.isAlive === false);

    return dead;
  }

  // async endGame(roomId: string): Promise<void> {
  //   const gameId = await this.getCurrentGameId(roomId);
  //   if (!gameId) {
  //     console.log(`room:${roomId}에 진행 중인 게임이 없음.`);
  //     return;
  //   }

  //   const gameKey = `room:${roomId}:game:${gameId}`;
  //   await this.redisClient.del(gameKey);
  //   await this.redisClient.del(`room:${roomId}:currentGameId`);

  //   console.log(`게임 ${gameId} 데이터 삭제 완료`);
  // }
}
