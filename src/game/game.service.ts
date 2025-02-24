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
    private readonly redisClient: Redis, // ioredis 클라이언트 주입
  ) {}

  // ──────────────────────────────
  // 유틸리티 메서드 (게임 ID 및 데이터 조회)
  // ──────────────────────────────

  // 현재 진행 중인 게임 ID 조회
  async getCurrentGameId(roomId: string): Promise<string | null> {
    const gameId = await this.redisClient.get(`room:${roomId}:currentGameId`);
    if (gameId) {
      return gameId;
    }
    console.log(`room:${roomId}:currentGameId 키가 없음. 게임 ID 검색 중...`);
    const keys = await this.redisClient.keys(`room:${roomId}:game:*`);
    if (keys.length === 0) return null;
    const foundGameId = keys[0].split(':').pop() || null;
    if (foundGameId) {
      await this.redisClient.set(`room:${roomId}:currentGameId`, foundGameId);
      console.log(`room:${roomId}의 현재 게임 ID를 복구: ${foundGameId}`);
    }
    return foundGameId;
  }

  // 특정 게임의 데이터 조회
  async getGameData(roomId: string, gameId: string): Promise<any> {
    if (!roomId || !gameId) {
      throw new BadRequestException('roomId와 gameId가 필요합니다.');
    }
    const redisKey = `room:${roomId}:game:${gameId}`;
    const gameData = (await this.redisClient.hgetall(redisKey)) || {};
    if (Object.keys(gameData).length === 0) {
      throw new BadRequestException('해당 게임 데이터가 존재하지 않습니다.');
    }
    gameData.players = gameData.players ? JSON.parse(gameData.players) : [];
    return gameData;
  }

  // ──────────────────────────────
  // 게임 초기화 및 상태 관리 메서드
  // ──────────────────────────────

  // 새로운 게임 생성 및 초기화
  async createGame(roomId: string): Promise<void> {
    if (!roomId) {
      throw new BadRequestException('roomId가 필요합니다.');
    }
    const gameId = uuidv4();
    const redisKey = `room:${roomId}:game:${gameId}`;
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

    await Promise.all(
      Object.entries(initialGameState).map(([field, value]) =>
        this.redisClient.hset(redisKey, field, value),
      ),
    );

    // 현재 진행 중인 게임 ID 저장
    await this.redisClient.set(`room:${roomId}:currentGameId`, gameId);
    console.log(`게임 ID ${gameId}가 방 ${roomId}에 저장되었습니다.`);
  }

  // 역할 분배
  async assignRoles(roomId: string, gameId: string): Promise<Player[]> {
    const redisKey = `room:${roomId}:game:${gameId}`;
    const gameData = await this.getGameData(roomId, gameId);
    const players: Player[] = gameData.players;
    const requiredPlayers = 8;
    console.log('플레이어 수:', players.length);
    if (players.length !== requiredPlayers) {
      throw new BadRequestException(
        '플레이어 수가 8인이 아니므로 역할 분배를 진행할 수 없습니다.',
      );
    }

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
    console.log('Updated Players:', updatedPlayers);

    await Promise.all([
      this.redisClient.hset(
        redisKey,
        'players',
        JSON.stringify(updatedPlayers),
      ),
      this.redisClient.hset(redisKey, 'phase', 'rolesAssigned'),
    ]);

    return updatedPlayers;
  }

  // 낮 단계 시작 (day 증가 및 투표 초기화)
  async startDayPhase(roomId: string, gameId: string): Promise<number> {
    const redisKey = `room:${roomId}:game:${gameId}`;
    const gameData = await this.getGameData(roomId, gameId);
    let currentDay = parseInt(gameData.day, 10) || 0;
    currentDay += 1;
    await this.redisClient.hset(redisKey, 'day', currentDay.toString());
    await this.redisClient.hset(redisKey, 'phase', 'day');
    await this.redisClient.hset(redisKey, 'firstVote', JSON.stringify([]));
    await this.redisClient.hset(redisKey, 'secondVote', JSON.stringify([]));
    return currentDay;
  }

  // 플레이어 사망 처리
  async killPlayers(roomId: string, playerIds: number[]): Promise<void> {
    const gameId = await this.getCurrentGameId(roomId);
    if (!gameId) {
      throw new BadRequestException('현재 진행 중인 게임이 존재하지 않습니다.');
    }
    const redisKey = `room:${roomId}:game:${gameId}`;
    const gameData = await this.getGameData(roomId, gameId);
    const players: Player[] = gameData.players;
    const updatedPlayers = players.map((player) => {
      if (playerIds.includes(player.id)) {
        return { ...player, isAlive: false };
      }
      return player;
    });
    await this.redisClient.hset(
      redisKey,
      'players',
      JSON.stringify(updatedPlayers),
    );
  }

  // ──────────────────────────────
  // 투표 관련 메서드
  // ──────────────────────────────

  // 1차 투표 진행
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
      throw new BadRequestException('현재 진행 중인 게임이 존재하지 않습니다.');
    }
    const firstVoteKey = `room:${roomId}:game:${gameId}:firstVote`;
    const gameKey = `room:${roomId}:game:${gameId}`;

    const votes = await this.redisClient.get(firstVoteKey);
    let voteArray: { voterId: number; targetId: number }[] = votes
      ? JSON.parse(votes)
      : [];

    if (voterId === targetId) {
      console.warn(`사용자 ${voterId}가 자기 자신에게 투표하려고 시도함.`);
      return { success: false, message: '자기 자신에게는 투표할 수 없습니다.' };
    }
    if (voteArray.some((vote) => vote.voterId === voterId)) {
      console.log('중복된 투표 감지(반영X)');
      return {
        success: false,
        message: '이미 투표하셨습니다. 다시 투표할 수 없습니다.',
      };
    }

    const gameData = await this.redisClient.hget(gameKey, 'players');
    const alivePlayers = JSON.parse(gameData as string).filter(
      (p: any) => p.isAlive,
    );
    voteArray.push({ voterId, targetId });
    await this.redisClient.set(firstVoteKey, JSON.stringify(voteArray));

    console.log(
      `1차 투표 완료 인원: ${voteArray.length} / 투표 가능 인원: ${alivePlayers.length}`,
    );
    if (voteArray.length !== alivePlayers.length) {
      return { success: true, voteData: voteArray, allVotesCompleted: false };
    }
    return { success: true, voteData: voteArray, allVotesCompleted: true };
  }

  // 1차 투표 결과 계산 및 저장 (동점이 아닐 경우)
  async calculateFirstVoteResult(roomId: string) {
    console.log(`calculateVoteResult 실행 - roomId: ${roomId}`);
    const gameId = await this.getCurrentGameId(roomId);
    if (!gameId) {
      throw new BadRequestException('현재 진행 중인 게임이 존재하지 않습니다.');
    }
    const firstVoteKey = `room:${roomId}:game:${gameId}:firstVote`;
    const votes = await this.redisClient.get(firstVoteKey);
    if (!votes) {
      return { winnerId: null, voteCount: 0, tie: false, tieCandidates: [] };
    }
    const voteArray: { voterId: number; targetId: number }[] =
      JSON.parse(votes);
    const voteCount: Record<number, number> = {};
    voteArray.forEach((vote) => {
      voteCount[vote.targetId] = (voteCount[vote.targetId] || 0) + 1;
    });
    console.log(`투표 집계 결과:`, voteCount);

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

    if (candidates.length === 1) {
      console.log(`최다 득표자 확인 - winnerId: ${candidates[0]}`);
      const winnerId = candidates[0];
      const gameKey = `room:${roomId}:game:${gameId}`;
      await this.redisClient.hset(
        gameKey,
        'firstVoteWinner',
        winnerId.toString(),
      );
      return { winnerId, voteCount: maxVotes, tie: false, tieCandidates: [] };
    } else {
      console.log(
        `동점 후보 발생 - 후보들: ${candidates.join(', ')}, 득표수: ${maxVotes}`,
      );
      return {
        winnerId: null,
        voteCount: maxVotes,
        tie: true,
        tieCandidates: candidates,
      };
    }
  }

  // 2차 투표 진행
  async handleSecondVoteProcess(
    roomId: string,
    voterId: number,
    execute: boolean,
  ) {
    console.log(
      `handleSecondVoteProcess 요청 - roomId: ${roomId}, voterId: ${voterId}, execute: ${execute}`,
    );
    const gameId = await this.getCurrentGameId(roomId);
    if (!gameId) {
      throw new BadRequestException('현재 진행 중인 게임이 존재하지 않습니다.');
    }
    const secondVoteKey = `room:${roomId}:game:${gameId}:secondVote`;
    const gameKey = `room:${roomId}:game:${gameId}`;

    const votes = await this.redisClient.get(secondVoteKey);
    let voteArray: { voterId: number; execute: boolean }[] = votes
      ? JSON.parse(votes)
      : [];

    const gameData = await this.redisClient.hget(gameKey, 'players');
    const alivePlayers = JSON.parse(gameData as string).filter(
      (p: any) => p.isAlive,
    );
    voteArray.push({ voterId, execute });
    await this.redisClient.set(secondVoteKey, JSON.stringify(voteArray));

    console.log(
      `2차 투표 완료 인원: ${voteArray.length} / 투표 가능 인원: ${alivePlayers.length}`,
    );
    if (voteArray.length !== alivePlayers.length) {
      return { success: true, voteData: voteArray, allVotesCompleted: false };
    }
    return { success: true, voteData: voteArray, allVotesCompleted: true };
  }

  // 2차 투표 결과 계산
  async calculateSecondVoteResult(roomId: string) {
    console.log(`calculateSecondVoteResult 실행 - roomId: ${roomId}`);
    const gameId = await this.getCurrentGameId(roomId);
    if (!gameId) {
      throw new BadRequestException('현재 진행 중인 게임이 존재하지 않습니다.');
    }
    const secondVoteKey = `room:${roomId}:game:${gameId}:secondVote`;
    const votes = await this.redisClient.get(secondVoteKey);
    if (!votes) {
      return { execute: false, voteCount: 0, tie: false };
    }
    const voteArray: { voterId: number; execute: boolean }[] =
      JSON.parse(votes);
    let executeCount = 0;
    let surviveCount = 0;
    voteArray.forEach((vote) => {
      vote.execute ? executeCount++ : surviveCount++;
    });
    console.log(
      `2차 투표 집계 결과: 사살(${executeCount}) vs 생존(${surviveCount})`,
    );

    const executeVoterIds = voteArray
      .filter((vote) => vote.execute)
      .map((vote) => vote.voterId);
    const surviveVoterIds = voteArray
      .filter((vote) => !vote.execute)
      .map((vote) => vote.voterId);

    if (executeCount > surviveCount) {
      return {
        execute: true,
        voteCount: executeCount,
        tie: false,
        executeVoterIds,
        surviveVoterIds,
      };
    } else if (executeCount < surviveCount) {
      return {
        execute: false,
        voteCount: surviveCount,
        tie: false,
        executeVoterIds,
        surviveVoterIds,
      };
    } else {
      return {
        execute: null,
        voteCount: executeCount,
        tie: true,
        executeVoterIds,
        surviveVoterIds,
      };
    }
  }

  // ──────────────────────────────
  // 타겟 ID 관련 메서드 (1차 투표 결과 기반)
  // ──────────────────────────────

  // targetId 저장
  async setTargetId(roomId: string, targetId: number): Promise<void> {
    const gameId = await this.getCurrentGameId(roomId);
    if (!gameId) {
      throw new BadRequestException('현재 진행 중인 게임이 존재하지 않습니다.');
    }
    const gameKey = `room:${roomId}:game:${gameId}`;
    await this.redisClient.hset(gameKey, 'targetId', targetId.toString());
    console.log(`게임: ${gameId}의 targetId: ${targetId} 레디스에 업데이트.`);
  }

  // targetId 조회
  async getTargetId(roomId: string): Promise<number | null> {
    const gameId = await this.getCurrentGameId(roomId);
    if (!gameId) {
      throw new BadRequestException('현재 진행 중인 게임이 존재하지 않습니다.');
    }
    const gameKey = `room:${roomId}:game:${gameId}`;
    const targetIdStr = await this.redisClient.hget(gameKey, 'targetId');
    if (!targetIdStr) {
      console.log(`게임 ${gameId}에 targetId가 설정되지 않았습니다.`);
      return null;
    }
    const targetId = Number(targetIdStr);
    console.log(`게임 ${gameId}에서 targetId ${targetId}를 불러왔습니다.`);
    return targetId;
  }

  // ──────────────────────────────
  // (필요시) 게임 종료 관련 메서드
  // ──────────────────────────────
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
