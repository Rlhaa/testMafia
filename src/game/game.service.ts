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

    this.timerService.startTimer(roomId, 'day', 120000).subscribe(() => {
      this.nightResultService.announceFirstVoteStart(roomId, currentDay); //2번째 인자, 3번째 인자? 전달받기 CHAN
    });

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
  async endGame(roomId: string): Promise<any> {
    // 현재 진행 중인 게임 ID 가져오기
    const gameId = await this.getCurrentGameId(roomId);
    if (!gameId) {
      console.log(`room:${roomId}에 진행 중인 게임이 없음.`);
      throw new BadRequestException('현재 진행 중인 게임이 존재하지 않습니다.');
    }

    // Redis에서 게임 데이터를 저장하는 키 생성
    const gameKey = `room:${roomId}:game:${gameId}`;
    const gameData = await this.getGameData(roomId, gameId);

    // 게임에 참여한 플레이어 목록 가져오기
    const players: Player[] = gameData.players;

    // 생존한 마피아와 시민 수 카운트
    const aliveMafias = players.filter(
      (player) => player.role === 'mafia' && player.isAlive,
    ).length;
    const aliveCitizens = players.filter(
      (player) => player.role !== 'mafia' && player.isAlive,
    ).length;

    let winningTeam = ''; // 최종 승리 팀 저장 변수

    // 게임 종료 조건 판단
    if (aliveMafias >= aliveCitizens) {
      winningTeam = 'mafia'; // 마피아 수가 시민 이상이면 마피아 승리
    } else if (aliveMafias === 0) {
      winningTeam = 'citizens'; // 마피아가 모두 죽으면 시민 승리
    } else {
      return { message: '게임이 아직 끝나지 않았습니다.' }; // 아직 게임 종료 조건을 충족하지 않음
    }

    // 최종 게임 상태 데이터 구성 (각 플레이어의 역할 및 생존 여부 포함)
    const finalState = {
      players: players.map((player) => ({
        userId: player.id,
        role: player.role,
        alive: player.isAlive,
      })),
    };

    // Redis에서 게임 관련 데이터 삭제 (게임 종료 처리)
    await this.redisClient.del(gameKey);
    await this.redisClient.del(`room:${roomId}:currentGameId`);

    // 최종 게임 결과 반환
    const result = {
      roomId,
      winningTeam,
      finalState,
      message: `게임 종료: ${winningTeam === 'mafia' ? '마피아' : '시민'} 승리!`,
    };

    return result;
  }

  // 1. 특정 역할(role)을 가진 살아있는 플레이어 찾기
  async getPlayerByRole(roomId: string, role: string): Promise<number | null> {
    const redisKey = `room:${roomId}:game`;
    const playersData = await this.redisClient.hget(redisKey, 'players');
    const players = JSON.parse(playersData || '[]');

    const player = players.find((p: any) => p.role === role && p.isAlive);
    return player ? Number(player.id) : null;
  }

  // 2. NIGHT 시작 - 게임 상태 변경
  async startNightPhase(
    roomId: string,
    gameId?: string,
  ): Promise<{ nightNumber: number; mafias: Player[]; dead: Player[] }> {
    const redisKey = gameId
      ? `room:${roomId}:game:${gameId}`
      : `room:${roomId}:game`;

    // 현재 게임 데이터를 가져올 필요가 있는 경우만 가져오기
    let currentDay = 0;
    if (gameId) {
      const gameData = await this.getGameData(roomId, gameId);
      currentDay = parseInt(gameData.day, 10) || 0;
    }

    // 게임의 phase를 `night`로 설정
    await this.redisClient.hset(redisKey, 'phase', 'night');

    // 밤 횟수 관리 (nightNumber 증가)
    const nightNumber = await this.getNightCount(roomId);

    // 마피아 목록 조회
    const mafias = await this.getMafias(roomId, gameId);

    // 사망자 목록 조회
    const dead = await this.getDead(roomId, gameId);

    return { nightNumber, mafias, dead };
  }

  // 3. 마피아 공격 대상 저장
  async selectMafiaTarget(
    roomId: string,
    userId: number | string,
    targetUserId: number | string,
  ): Promise<void> {
    const userIdNum = Number(userId);
    const targetUserIdNum = Number(targetUserId);

    const redisKey = `room:${roomId}:game`;
    await this.redisClient.hset(
      redisKey,
      'mafiaTarget',
      targetUserIdNum.toString(),
    );

    console.log(`마피아(${userIdNum})가 ${targetUserIdNum}를 대상으로 선택함.`);
  }

  // 4. 경찰 조사 대상 저장
  async savePoliceTarget(
    roomId: string,
    targetUserId: number | string,
  ): Promise<void> {
    const targetUserIdNum = Number(targetUserId);
    const redisKey = `room:${roomId}:game`;

    await this.redisClient.hset(
      redisKey,
      'policeTarget',
      targetUserIdNum.toString(),
    );
  }

  // 5. 의사 보호 대상 저장
  async saveDoctorTarget(
    roomId: string,
    targetUserId: number | string,
  ): Promise<void> {
    const targetUserIdNum = Number(targetUserId);
    const redisKey = `room:${roomId}:game`;

    await this.redisClient.hset(
      redisKey,
      'doctorTarget',
      targetUserIdNum.toString(),
    );
  }

  // 6. 경찰 조사 결과 조회
  async getPoliceResult(roomId: string): Promise<{
    policeId: number | null;
    targetUserId: number | null;
    role: string | null;
  }> {
    const policeId = await this.getPlayerByRole(roomId, 'police');
    if (!policeId) return { policeId: null, targetUserId: null, role: null };

    const redisKey = `room:${roomId}:game`;
    const policeTarget = await this.redisClient.hget(redisKey, 'policeTarget');
    if (!policeTarget) return { policeId, targetUserId: null, role: null };

    const playersData = await this.redisClient.hget(redisKey, 'players');
    const players = JSON.parse(playersData || '[]');

    const targetPlayer = players.find(
      (p: any) => p.id === Number(policeTarget),
    );
    const role = targetPlayer?.role === 'mafia' ? 'mafia' : 'citizen';

    return { policeId, targetUserId: Number(policeTarget), role };
  }

  // 7. 밤 결과 처리
  async processNightResult(
    roomId: string,
  ): Promise<{ killedUserId: number | null; details: string }> {
    const redisKey = `room:${roomId}:game`;

    const mafiaTarget = await this.redisClient.hget(redisKey, 'mafiaTarget');
    const doctorTarget = await this.redisClient.hget(redisKey, 'doctorTarget');

    let killedUserId = mafiaTarget ? Number(mafiaTarget) : null;
    let details = '마피아 공격 성공';

    if (
      mafiaTarget &&
      doctorTarget &&
      Number(mafiaTarget) === Number(doctorTarget)
    ) {
      killedUserId = null;
      details = '의사 보호로 인해 살해 취소됨';
    } else if (mafiaTarget) {
      await this.markPlayerAsDead(roomId, Number(mafiaTarget));
    }

    return { killedUserId, details };
  }

  // 8. 플레이어 사망 처리
  async markPlayerAsDead(roomId: string, playerId: number): Promise<void> {
    const redisKey = `room:${roomId}:game`;
    const playersData = await this.redisClient.hget(redisKey, 'players');
    const players = JSON.parse(playersData || '[]');

    const player = players.find((p: any) => p.id === playerId);
    if (player) player.isAlive = false;

    await this.redisClient.hset(redisKey, 'players', JSON.stringify(players));
  }

  // 9. 밤 횟수 관리
  async getNightCount(roomId: string): Promise<number> {
    const redisKey = `room:${roomId}:game`;
    const nightNumber = await this.redisClient.hget(redisKey, 'nightNumber');
    const newNightCount = nightNumber ? parseInt(nightNumber) + 1 : 1;

    await this.redisClient.hset(
      redisKey,
      'nightNumber',
      newNightCount.toString(),
    );
    return newNightCount;
  }
}
