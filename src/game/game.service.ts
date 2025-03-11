import {
  Injectable,
  BadRequestException,
  Inject,
  Logger,
  forwardRef,
} from '@nestjs/common';
import { Redis } from 'ioredis';
import { v4 as uuidv4 } from 'uuid';
import { TimerService } from 'src/timer/timer.service';
import { NightResultService } from 'src/notice/night-result.service';
import { RoomGateway } from 'src/room/room.gateway';
import { Server, Socket, RemoteSocket } from 'socket.io';

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
  private readonly logger = new Logger(GameService.name); //타이머 로그용 임시 추가
  constructor(
    @Inject('REDIS_CLIENT')
    private readonly redisClient: Redis, // ioredis 클라이언트 주입 (로컬 또는 Elasticache Redis)
    private readonly timerService: TimerService, // 타이머 테스트용
    @Inject(forwardRef(() => NightResultService))
    private readonly nightResultService: NightResultService, //
    @Inject(forwardRef(() => RoomGateway))
    private readonly roomGateway: RoomGateway,
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
    ); // room:${roomId}:game:${gameId} 해시값

    // 현재 진행 중인 게임 ID 저장
    await this.redisClient.set(`room:${roomId}:currentGameId`, gameId);
    console.log(`게임 ID ${gameId}가 방 ${roomId}에 저장되었습니다.`);
  }

  // 역할 분배
  async assignRoles(roomId: string, gameId: string): Promise<Player[]> {
    this.redisClient.hset(`room:${roomId}`, 'status', '게임 중');
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
    rolesPool.sort(() => Math.random() - 0.5); // 역할 풀 무작위 순서로 섞기

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
  async startDayPhase(
    roomId: string,
    gameId: string,
    server: Server,
  ): Promise<number> {
    const redisKey = `room:${roomId}:game:${gameId}`;
    const gameData = await this.getGameData(roomId, gameId);
    let currentDay = parseInt(gameData.day, 10) || 0;
    currentDay += 1;
    await this.redisClient.hset(redisKey, 'day', currentDay.toString());
    await this.redisClient.hset(redisKey, 'phase', 'day');
    await this.redisClient.hset(redisKey, 'firstVote', JSON.stringify([]));
    await this.redisClient.hset(redisKey, 'secondVote', JSON.stringify([]));

    await this.clearNightActions(roomId);
    server.to(roomId).emit('VOTE:FIRST:ENABLE');
    server.to(roomId).emit('message', {
      sender: 'system',
      message: `Day ${currentDay} 낮이 밝았습니다!`,
    });
    let phase = 'day';
    this.timerService.startTimer(roomId, 'day', 120000).subscribe({
      next: (remainingTime) => {
        // 1초마다 실행되는 시간이벤트
        let data = { timerTime: remainingTime, phase };
        server.to(roomId).emit('updateTimer', data);
      },
      complete: () => {
        if (this.timerService.getTimerCompleted(roomId, phase)) {
          this.roomGateway.announceFirstVoteStart(roomId, currentDay);
        }
      },
    });
    return currentDay;
  }

  //투표 결과 초기화 함수
  async clearDayVote(roomId: string): Promise<void> {
    const gameId = await this.getCurrentGameId(roomId);
    if (!gameId) return;

    const redisFirstKey = `room:${roomId}:game:${gameId}:firstVote`;
    const redisSecondKey = `room:${roomId}:game:${gameId}:secondVote`;
    // 각 역할의 밤 행동 상태를 삭제
    await Promise.all([
      this.redisClient.set(redisFirstKey, JSON.stringify([])),
      this.redisClient.set(redisSecondKey, JSON.stringify([])),
    ]);

    console.log(`🔄 Room ${roomId}의 낮 투표 상태가 초기화되었습니다.`);
  }

  // 플레이어 사망
  async killPlayers(roomId: string, playerIds: number[]): Promise<void> {
    const gameId = await this.getCurrentGameId(roomId);
    if (!gameId) {
      throw new BadRequestException('현재 진행 중인 게임이 존재하지 않습니다.');
    }
    const redisKey = `room:${roomId}:game:${gameId}`;
    const gameData = await this.getGameData(roomId, gameId);
    const players: Player[] = gameData.players;
    let currentCitizenCounts = gameData.citizenCount;
    let currentMafiaCounts = gameData.mafiaCount;
    console.log('----------------', playerIds);
    // 선택된 플레이어의 isAlive 속성을 false로 변경
    const updatedPlayers = players.map((player) => {
      if (playerIds.includes(+player.id)) {
        player.role === 'mafia' ? currentMafiaCounts-- : currentCitizenCounts--;
        return { ...player, isAlive: false };
      }
      return player;
    });
    console.log(updatedPlayers);

    await this.redisClient.hset(
      redisKey,
      'players',
      JSON.stringify(updatedPlayers),
    );
    if (currentMafiaCounts < gameData.mafiaCount)
      await this.redisClient.hset(redisKey, 'mafiaCount', currentMafiaCounts);
    if (currentCitizenCounts < gameData.citizenCount)
      await this.redisClient.hset(
        redisKey,
        'citizenCount',
        currentCitizenCounts,
      );

    // 🔹 데이터 확인을 위해 사망자 목록 가져오기
    const deadPlayers = updatedPlayers.filter((player) => !player.isAlive);
    console.log(`사망 처리 후 사망자 목록:`, deadPlayers);
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
      return { winnerId: null, voteCount: 0, tie: true, tieCandidates: [] };
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
      return {
        execute: false,
        voteCount: 0,
        tie: false,
        executeVoterIds: [],
        surviveVoterIds: [],
      };
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
  async endGame(roomId: string): Promise<any> {
    // 현재 진행 중인 게임 ID 가져오기
    const gameId = await this.getCurrentGameId(roomId);
    if (!gameId) {
      console.log(`room:${roomId}에 진행 중인 게임이 없음.`);
      throw new BadRequestException('현재 진행 중인 게임이 존재하지 않습니다.');
    }

    // Redis에서 게임 데이터를 저장하는 키 생성
    const gameKey = `room:${roomId}:game:${gameId}`;
    const gameResultKey = `gameResult:${gameId}`;
    const gameAchievementsKey = `gameAchievements:${gameId}`;
    const gameLockKey = `lock:endGame:${roomId}`; // 중복 실행 방지용 Redis Lock 키

    // 중복 실행 방지: Lock 확인
    const isLocked = await this.redisClient.exists(gameLockKey);
    if (isLocked) {
      console.warn(
        `게임 종료가 이미 진행 중 (roomId: ${roomId}), 중복 실행 방지.`,
      );
      return;
    }

    // Lock 설정 (게임 종료가 실행 중임을 표시)
    await this.redisClient.set(gameLockKey, 'locked');

    let winningTeam = '';
    let winningMessage = '';

    try {
      const gameData = await this.getGameData(roomId, gameId);
      const players: Player[] = gameData.players;

      // 생존한 마피아와 시민 수 카운트
      const aliveMafias = players.filter(
        (player) => player.role === 'mafia' && player.isAlive,
      ).length;
      const aliveCitizens = players.filter(
        (player) => player.role !== 'mafia' && player.isAlive,
      ).length;

      if (aliveMafias >= aliveCitizens) {
        winningTeam = 'mafia';
      } else if (aliveMafias === 0) {
        winningTeam = 'citizens';
      } else {
        return { message: '게임이 아직 끝나지 않았습니다.' };
      }

      //  메시지 설정
      winningMessage = winningTeam === 'mafia' ? '마피아 승리' : '시민 승리';

      // **이미 저장된 게임 결과인지 확인 (중복 방지)**
      const isAlreadyStored = await this.redisClient.exists(gameResultKey);
      if (isAlreadyStored) {
        console.warn(`이미 저장된 게임 결과 (gameId: ${gameId}), 저장 안 함.`);
        return;
      }

      // 최종 게임 상태 데이터 구성
      const finalState = {
        players: players.map((player) => ({
          userId: player.id,
          role: player.role,
          alive: player.isAlive,
        })),
      };

      // 유저별 능력 사용 데이터 조회
      const playerStats = {};
      for (const player of players) {
        const stats = await this.redisClient.hgetall(`user:${player.id}:stats`);
        playerStats[player.id] = stats;
      }

      // 게임 업적 데이터 구성
      const gameAchievements = {
        roomId,
        gameId,
        playerAchievements: playerStats,
        timestamp: new Date().toISOString(),
      };

      // 게임 결과 데이터 구성
      const gameResult = {
        roomId,
        gameId,
        winningTeam,
        finalState,
        timestamp: new Date().toISOString(),
      };

      // Redis 트랜잭션을 사용하여 게임 결과 및 업적 저장
      const multi = this.redisClient.multi();
      multi.set(gameResultKey, JSON.stringify(gameResult), 'EX', 86400);
      multi.publish('gameResults', JSON.stringify(gameResult));

      multi.set(
        gameAchievementsKey,
        JSON.stringify(gameAchievements),
        'EX',
        86400,
      );
      multi.publish('gameAchievements', JSON.stringify(gameAchievements));

      await multi.exec();

      console.log(`✅ 게임 종료: ${winningMessage} (gameId: ${gameId})`);
      console.log(`게임 결과가 저장됨 (gameId: ${gameId})`);
      console.log(`게임 업적이 저장됨 (gameId: ${gameId})`);

      // 게임 데이터 삭제
      await this.redisClient.del(gameKey);
      await this.redisClient.del(`room:${roomId}:currentGameId`);
      await this.redisClient.hset(`room:${roomId}`, 'status', '대기 중');
    } finally {
      // 실행이 끝나면 lock 해제
      await this.redisClient.del(gameLockKey);
    }

    //  최종 반환 메시지 (변수 접근 가능)
    return {
      message: winningMessage, // "마피아 승리" 또는 "시민 승리"
      winningTeam, // "mafia" 또는 "citizens"
      isGameOver: true,
    };
  }

  /// 1. 특정 역할(role)을 가진 살아있는 플레이어 찾기
  async getPlayerByRole(roomId: string, role: string): Promise<number | null> {
    const gameId = await this.getCurrentGameId(roomId);
    if (!gameId) return null;

    const gameData = await this.getGameData(roomId, gameId);
    const players = gameData.players || [];

    const player = players.find((p: any) => p.role === role && p.isAlive);
    return player ? Number(player.id) : null;
  }

  // 2. NIGHT 시작 - 게임 상태 변경 및 클라이언트 알림
  async startNightPhase(
    roomId: string,
    server: Server,
  ): Promise<{ nightNumber: number; mafias: Player[]; dead: Player[] }> {
    const gameId = await this.getCurrentGameId(roomId);
    if (!gameId)
      throw new BadRequestException('현재 진행 중인 게임이 없습니다.');

    const redisKey = `room:${roomId}:game:${gameId}`;
    console.log(`🔹 방 ${roomId} - 밤으로 전환됨.`);

    // 게임의 phase를 'night'로 설정
    await this.redisClient.hset(redisKey, 'phase', 'night');

    // 밤 횟수 관리 (nightNumber 증가)
    const nightNumber = await this.getNightCount(roomId);

    // 마피아 및 사망자 목록 조회
    const mafias = await this.getMafias(roomId, gameId);
    const dead = await this.getDead(roomId, gameId);

    // 클라이언트에 밤 시작 이벤트 전송
    this.nightResultService.announceNightStart(roomId, mafias, dead);

    console.log(
      `✅ 방 ${roomId} - NIGHT ${nightNumber} 시작됨. 마피아 수: ${mafias.length}, 사망자 수: ${dead.length}`,
    );
    let phase = 'night';
    await this.clearDayVote(roomId);
    this.timerService.startTimer(roomId, 'night', 30000).subscribe({
      next: (remainingTime) => {
        // 1초마다 실행되는 시간이벤트
        let data = { timerTime: remainingTime, phase };
        server.to(roomId).emit('updateTimer', data);
      },
      complete: () => {
        if (this.timerService.getTimerCompleted(roomId, phase)) {
          this.triggerNightProcessing(server, roomId); //2번째 인자, 3번째 인자? 전달받기 CHAN
        }
      },
    });
    return { nightNumber, mafias, dead };
  }

  // 3. 경찰 조사 결과 조회
  async getPoliceResult(roomId: string): Promise<{
    policeId?: number;
    targetUserId?: number;
    role?: string;
  }> {
    const gameId = await this.getCurrentGameId(roomId);
    if (!gameId) return {}; // 게임이 없으면 빈 객체 반환

    const redisKey = `room:${roomId}:game:${gameId}`;
    const policeId = await this.getPlayerByRole(roomId, 'police');

    // 경찰이 없으면 결과 반환하지 않음
    if (!policeId) return {};

    const policeTarget = await this.redisClient.hget(redisKey, 'policeTarget');
    if (!policeTarget) return { policeId }; // 조사 대상 없으면 경찰 ID만 반환

    const gameData = await this.getGameData(roomId, gameId);
    const players = gameData.players || [];

    const targetPlayer = players.find(
      (p: any) => p.id === Number(policeTarget),
    );

    return {
      policeId,
      targetUserId: Number(policeTarget),
      role: targetPlayer?.role === 'mafia' ? 'mafia' : 'citizen',
    };
  }

  // 4. 플레이어 사망 처리
  async markPlayerAsDead(roomId: string, playerId: number): Promise<void> {
    const gameId = await this.getCurrentGameId(roomId);
    if (!gameId)
      throw new BadRequestException('현재 진행 중인 게임이 없습니다.');

    const redisKey = `room:${roomId}:game:${gameId}`;
    const gameData = await this.getGameData(roomId, gameId);
    const players = gameData.players || [];
    let currentCitizenCounts = gameData.citizenCount;
    let currentMafiaCounts = gameData.mafiaCount;

    console.log('+++++++++++++', players);
    console.log('--------------', playerId);
    const player = players.find((p: any) => p.id === String(playerId));
    if (player)
      player.role === 'mafia' ? currentMafiaCounts-- : currentCitizenCounts--;
    player.isAlive = false;

    await this.redisClient.hset(redisKey, 'players', JSON.stringify(players));
  }

  // 5. 밤 횟수 관리
  async getNightCount(roomId: string): Promise<number> {
    const gameId = await this.getCurrentGameId(roomId);
    if (!gameId)
      throw new BadRequestException('현재 진행 중인 게임이 없습니다.');

    const redisKey = `room:${roomId}:game:${gameId}`;
    const nightNumber = await this.redisClient.hget(redisKey, 'nightNumber');
    const newNightCount = nightNumber ? parseInt(nightNumber) + 1 : 1;

    await this.redisClient.hset(
      redisKey,
      'nightNumber',
      newNightCount.toString(),
    );
    return newNightCount;
  }
  // 6. 의사 보호하는 메서드
  async setPlayerAlive(roomId: string, playerId: number): Promise<void> {
    const gameId = await this.getCurrentGameId(roomId);
    if (!gameId) {
      throw new BadRequestException('현재 진행 중인 게임이 존재하지 않습니다.');
    }
    const redisKey = `room:${roomId}:game:${gameId}`;
    const gameData = await this.getGameData(roomId, gameId);
    const players: Player[] = gameData.players || [];
    const player = players.find((p: any) => p.id === playerId);
    if (player) {
      player.isAlive = true;
      await this.redisClient.hset(redisKey, 'players', JSON.stringify(players));
    }
  }

  // 7. 밤 행동 완료 상태를 Redis에 저장
  async setNightActionComplete(
    roomId: string,
    role: 'mafia' | 'police' | 'doctor',
  ): Promise<void> {
    const gameId = await this.getCurrentGameId(roomId);
    if (!gameId)
      throw new BadRequestException('현재 진행 중인 게임이 없습니다.');

    const redisKey = `room:${roomId}:game:${gameId}`;
    await this.redisClient.hset(redisKey, `nightAction:${role}`, 'true');

    console.log(`✅ ${role} 역할이 밤 행동을 완료했습니다.`);
  }

  // 8. 모든 밤 행동이 완료되었는지 체크
  async checkAllNightActionsCompleted(roomId: string): Promise<boolean> {
    const gameId = await this.getCurrentGameId(roomId);
    if (!gameId) return false;

    const redisKey = `room:${roomId}:game:${gameId}`;
    const gameData = await this.getGameData(roomId, gameId);
    const players: Player[] = gameData.players;

    // 🔹 살아있는 역할만 체크 (죽은 사람은 자동 완료 처리)
    const isAlive = (role: string) =>
      players.some((p) => p.role === role && p.isAlive);

    const [mafiaDone, policeDone, doctorDone] = await Promise.all([
      this.redisClient
        .hget(redisKey, 'nightAction:mafia')
        .then((res) => res === 'true'),
      isAlive('police')
        ? this.redisClient
            .hget(redisKey, 'nightAction:police')
            .then((res) => res === 'true')
        : true, // 경찰이 죽었으면 자동 true
      isAlive('doctor')
        ? this.redisClient
            .hget(redisKey, 'nightAction:doctor')
            .then((res) => res === 'true')
        : true, // 의사가 죽었으면 자동 true
    ]);

    const allActionsCompleted = mafiaDone && policeDone && doctorDone;

    console.log(
      `🕵️‍♂️ 밤 액션 완료 체크: Mafia:${mafiaDone}, Police:${policeDone}, Doctor:${doctorDone} -> ${
        allActionsCompleted ? '✅ 모든 액션 완료' : '❌ 미완료'
      }`,
    );

    return allActionsCompleted;
  }

  // 밤 행동 상태를 초기화하는 메서드
  async clearNightActions(roomId: string): Promise<void> {
    const gameId = await this.getCurrentGameId(roomId);
    if (!gameId) return;

    const redisKey = `room:${roomId}:game:${gameId}`;

    // 각 역할의 밤 행동 상태를 삭제
    await Promise.all([
      this.redisClient.hdel(redisKey, 'nightAction:mafia'),
      this.redisClient.hdel(redisKey, 'nightAction:police'),
      this.redisClient.hdel(redisKey, 'nightAction:doctor'),
    ]);

    console.log(`🔄 Room ${roomId}의 밤 행동 상태가 초기화되었습니다.`);
  }

  async checkEndGame(
    roomId: string,
  ): Promise<{ isGameOver: boolean; winningTeam: string | null }> {
    const gameId = await this.getCurrentGameId(roomId);
    if (!gameId) {
      console.log(`room:${roomId}에 진행 중인 게임이 없음.`);
      return { isGameOver: false, winningTeam: null };
    }

    // 현재 게임 데이터를 조회
    const gameData = await this.getGameData(roomId, gameId);
    const players: Player[] = gameData.players;

    // 생존한 마피아와 시민 수 카운트
    const aliveMafias = players.filter(
      (player) => player.role === 'mafia' && player.isAlive,
    ).length;
    const aliveCitizens = players.filter(
      (player) => player.role !== 'mafia' && player.isAlive,
    ).length;

    // 게임 종료 조건 판단
    if (aliveMafias >= aliveCitizens) {
      console.log(`게임 종료 - 마피아 승리`);
      return { isGameOver: true, winningTeam: 'mafia' };
    } else if (aliveMafias === 0) {
      console.log(`게임 종료 - 시민 승리`);
      return { isGameOver: true, winningTeam: 'citizens' };
    }

    return { isGameOver: false, winningTeam: null };
  }

  // 마피아가 지목하는 함수
  async selectMafiaTarget(
    roomId: string,
    userId: number,
    targetUserId: number,
  ): Promise<void> {
    const gameId = await this.getCurrentGameId(roomId);
    if (!gameId)
      throw new BadRequestException('현재 진행 중인 게임이 없습니다.');

    const redisKey = `room:${roomId}:game:${gameId}`;
    // 게임 데이터 가져오기
    const gameData = await this.getGameData(roomId, gameId);
    const players: Player[] = gameData.players;

    // 현재 마피아가 살아있는지 확인
    const mafiaPlayer = players.find((p) => p.id === userId);
    if (!mafiaPlayer || !mafiaPlayer.isAlive) {
      throw new BadRequestException(
        `죽은 플레이어(${userId})는 타겟을 지정할 수 없습니다.`,
      );
    }

    // 기존 마피아 타겟 불러오기
    const mafiaTargetsStr = await this.redisClient.hget(
      redisKey,
      'mafiaTargets',
    );
    let mafiaTargets: { userId: number; targetId: number }[] = mafiaTargetsStr
      ? JSON.parse(mafiaTargetsStr)
      : [];

    // 이미 선택한 마피아가 중복 선택하지 못하도록 필터링
    mafiaTargets = mafiaTargets.filter((entry) => entry.userId !== userId);

    // 새로운 타겟 추가
    mafiaTargets.push({ userId, targetId: targetUserId });

    await this.redisClient.hset(
      redisKey,
      'mafiaTargets',
      JSON.stringify(mafiaTargets),
    );

    //  마피아 능력 사용 횟수 저장 (Redis 증가)
    await this.redisClient.hincrby(`user:${userId}:stats`, 'mafia_kills', 1);

    console.log(`🔫 마피아(${userId})가 ${targetUserId}를 대상으로 선택함.`);
  }

  // 경찰이 지목하는 함수
  async savePoliceTarget(roomId: string, targetUserId: number): Promise<void> {
    const gameId = await this.getCurrentGameId(roomId);
    if (!gameId)
      throw new BadRequestException('현재 진행 중인 게임이 없습니다.');

    const redisKey = `room:${roomId}:game:${gameId}`;
    const gameData = await this.getGameData(roomId, gameId);
    const players: Player[] = gameData.players;
    //경찰 플레이어 생존 여부 확인
    const policePlayer = players.find((p) => p.role === 'police');
    if (!policePlayer || !policePlayer.isAlive) {
      throw new BadRequestException('죽은 경찰은 타겟을 지정할 수 없습니다.');
    }

    await this.redisClient.hset(
      redisKey,
      'policeTarget',
      targetUserId.toString(),
    );

    //  경찰 능력 사용 횟수 저장 (Redis 증가)
    const policeId = await this.getPlayerByRole(roomId, 'police');
    if (policeId) {
      await this.redisClient.hincrby(
        `user:${policeId}:stats`,
        'detective_checks',
        1,
      );
    }
  }

  // 의사가 지목하는 함수
  async saveDoctorTarget(roomId: string, targetUserId: number): Promise<void> {
    const gameId = await this.getCurrentGameId(roomId);
    if (!gameId)
      throw new BadRequestException('현재 진행 중인 게임이 없습니다.');

    const redisKey = `room:${roomId}:game:${gameId}`;
    const gameData = await this.getGameData(roomId, gameId);
    const players: Player[] = gameData.players;

    // 의사 플레이어 찾기 및 생존 여부 확인
    const doctorPlayer = players.find((p) => p.role === 'doctor');
    if (!doctorPlayer || !doctorPlayer.isAlive) {
      throw new BadRequestException('죽은 의사는 타겟을 지정할 수 없습니다.');
    }

    await this.redisClient.hset(
      redisKey,
      'doctorTarget',
      targetUserId.toString(),
    );

    //  의사 능력 사용 횟수 저장 (Redis 증가)
    const doctorId = await this.getPlayerByRole(roomId, 'doctor');
    if (doctorId) {
      await this.redisClient.hincrby(`user:${doctorId}:stats`, 'heal_used', 1);
    }
  }

  // 밤 결과 처리 함수
  // 밤 결과 처리 함수 (마피아, 의사, 경찰 능력 반영)
  async processNightResult(roomId: string): Promise<{
    killedUserId?: number;
    details: string;
    policeResult?: any;
  }> {
    const gameId = await this.getCurrentGameId(roomId);
    if (!gameId)
      throw new BadRequestException('현재 진행 중인 게임이 존재하지 않습니다.');

    const redisKey = `room:${roomId}:game:${gameId}`;

    // ✅ 마피아가 선택한 타겟 목록 가져오기
    const mafiaTargetsStr = await this.redisClient.hget(
      redisKey,
      'mafiaTargets',
    );
    const doctorTargetStr = await this.redisClient.hget(
      redisKey,
      'doctorTarget',
    );

    const mafiaTargets = mafiaTargetsStr ? JSON.parse(mafiaTargetsStr) : [];
    const doctorTarget = doctorTargetStr ? Number(doctorTargetStr) : undefined;

    console.log(
      `🔍 마피아 타겟 목록: ${mafiaTargets}, 의사 보호 대상: ${doctorTarget}`,
    );

    let killedUserId: number | undefined;
    let nightSummary = '';

    if (mafiaTargets.length > 0) {
      // ✅ 마피아들이 투표한 타겟 중에서 랜덤으로 한 명 선택
      const randomTarget =
        mafiaTargets[Math.floor(Math.random() * mafiaTargets.length)].targetId;

      console.log(`🎯 선택된 랜덤 타겟: ${randomTarget}`);

      if (randomTarget !== doctorTarget) {
        console.log(`💀 플레이어 ${randomTarget} 사망 처리.`);
        await this.markPlayerAsDead(roomId, randomTarget);
        killedUserId = randomTarget;
        nightSummary += `지난 밤, 플레이어 ${randomTarget}가 사망했습니다. `;
      } else {
        console.log(`🛡️ 의사가 ${randomTarget}를 보호하여 살해가 무효화됨.`);
        nightSummary += `의사가 플레이어 ${randomTarget}를 보호하여 살해가 무효화되었습니다. `;
      }
    }

    // ✅ 경찰 조사 결과 가져오기
    const policeResult = await this.getPoliceResult(roomId);

    // ✅ 최종 결과 반환
    const result: any = { killedUserId, details: nightSummary.trim() };
    if (Object.keys(policeResult).length > 0) {
      result.policeResult = policeResult;
    }

    console.log(`🌙 [NIGHT RESULT] 최종 처리 결과:`, result);
    // 클라이언트 한테 여기서 보내 줘야 한다.
    // this.roomGateway.handleNightResult()

    return result;
  }

  // 마피아,경찰,의사가 행동을 완료했을 때에 작동하는 함수
  async triggerNightProcessing(server: Server, roomId: string) {
    try {
      console.log(`🔥 모든 밤 액션이 완료됨. 밤 결과 처리 시작...`);

      // 게임 결과 전송
      const result = await this.roomGateway.handleNightResult(roomId);

      // ✅ 낮 단계로 즉시 이동
      console.log(`🌞 낮 단계로 전환 준비 중...`);
      const gameId = await this.getCurrentGameId(roomId);
      if (gameId) {
        // 🔹 낮으로 전환되기 전에 phase를 'day'로 설정
        await this.redisClient.hset(
          `room:${roomId}:game:${gameId}`,
          'phase',
          'day',
        );

        const newDay = await this.startDayPhase(roomId, gameId, server);
        return { gameOver: false, nightResult: result, newDay };
      }
      return { gameOver: false, nightResult: null, newDay: null };
    } catch (error) {
      console.error(`🚨 NIGHT 처리 중 오류 발생:`, error);
      return { gameOver: false, nightResult: null, newDay: null };
    }
  }

  // ✅ 현재 게임의 phase (낮 / 밤)를 가져오는 메서드 추가
  async getGamePhase(roomId: string): Promise<string | null> {
    const gameId = await this.getCurrentGameId(roomId);
    if (!gameId) {
      return null;
    }

    const redisKey = `room:${roomId}:game:${gameId}`;
    const phase = await this.redisClient.hget(redisKey, 'phase');

    console.log(`🧐 방 ${roomId}의 현재 phase: ${phase}`); // 🔹 현재 상태 확인

    return phase;
  }

  // ✅ 밤 결과가 이미 처리되었는지 확인하는 메서드
  async isNightResultProcessed(roomId: string): Promise<boolean> {
    const gameId = await this.getCurrentGameId(roomId);
    if (!gameId) return false;

    const redisKey = `room:${roomId}:game:${gameId}`;
    const resultProcessed = await this.redisClient.hget(
      redisKey,
      'nightResultProcessed',
    );

    return resultProcessed === 'true';
  }

  // ✅ 밤 결과가 처리되었음을 기록하는 메서드
  async setNightResultProcessed(roomId: string): Promise<void> {
    const gameId = await this.getCurrentGameId(roomId);
    if (!gameId) return;

    const redisKey = `room:${roomId}:game:${gameId}`;
    await this.redisClient.hset(redisKey, 'nightResultProcessed', 'true');
  }

  // ✅ 밤 결과 처리 상태를 삭제하는 메서드
  async removeNightResultProcessed(roomId: string): Promise<void> {
    const gameId = await this.getCurrentGameId(roomId);
    if (!gameId) return;

    const redisKey = `room:${roomId}:game:${gameId}`;
    await this.redisClient.hdel(redisKey, 'nightResultProcessed');
  }
}
