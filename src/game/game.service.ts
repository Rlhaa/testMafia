// src/game/game.service.ts
import { Injectable } from '@nestjs/common';
import { redisClient } from '../redis/redis.client';
import { Player } from './models/player.model';
import { Game } from './models/game.model';

@Injectable()
export class GameService {
  // 플레이어를 해당 방에 추가
  async addPlayerToRoom(roomId: string, player: Player): Promise<void> {
    const roomKey = `room:${roomId}`;
    const roomData = await redisClient.get(roomKey);
    if (!roomData) {
      throw new Error('해당 방이 존재하지 않습니다.');
    }
    console.log(`플레이어 ${player.username} 추가됨: ${roomId}`);
    // 실제 구현에서는 방의 플레이어 목록 업데이트 로직 추가
  }

  // 게임 시작: 역할 분배 및 초기 게임 객체 생성 (DAY1 낮)
  // 수정: 할당된 플레이어 배열을 반환
  async startGame(roomId: string): Promise<Player[]> {
    const roles: ('mafia' | 'citizen' | 'police' | 'doctor')[] = [
      'mafia',
      'mafia',
      'citizen',
      'citizen',
      'citizen',
      'citizen',
      'police',
      'doctor',
    ];
    const players = await this.getPlayersForRoom(roomId);
    if (players.length !== 8) {
      throw new Error('8명의 플레이어가 모여야 게임을 시작할 수 있습니다.');
    }
    // 역할 무작위 분배
    const shuffledRoles = roles.sort(() => Math.random() - 0.5);
    players.forEach((player, index) => {
      player.role = shuffledRoles[index];
    });
    const game: Game = {
      id: Date.now(),
      roomId,
      round: 1,
      playersId: players.map((p) => p.userId),
      isNight: false,
      targetIds: [],
      aliveIds: players.map((p) => p.userId),
      deadIds: [],
      isVote: false,
    };
    await redisClient.set(`game:${roomId}`, JSON.stringify(game));
    console.log(`게임 시작됨: ${roomId}, 라운드: ${game.round}`);
    // 반환된 플레이어 배열에는 이미 역할이 할당되어 있음
    return players;
  }

  // 하드코딩된 플레이어 목록 반환 (실제 구현 시 DB나 Redis에서 조회)
  async getPlayersForRoom(roomId: string): Promise<Player[]> {
    return [
      { id: 1, userId: 1001, username: 'Player1', roomId, isAlive: true },
      { id: 2, userId: 1002, username: 'Player2', roomId, isAlive: true },
      { id: 3, userId: 1003, username: 'Player3', roomId, isAlive: true },
      { id: 4, userId: 1004, username: 'Player4', roomId, isAlive: true },
      { id: 5, userId: 1005, username: 'Player5', roomId, isAlive: true },
      { id: 6, userId: 1006, username: 'Player6', roomId, isAlive: true },
      { id: 7, userId: 1007, username: 'Player7', roomId, isAlive: true },
      { id: 8, userId: 1008, username: 'Player8', roomId, isAlive: true },
    ];
  }

  // 플레이어 준비 상태 처리 (예시)
  async setPlayerReady(roomId: string, userId: number): Promise<void> {
    console.log(`플레이어 ${userId}가 준비됨.`);
    // 실제 구현에서는 준비 상태 저장 후, 모두 준비되면 다음 단계 진행 로직 추가
  }

  // 야간 행동 처리: 마피아, 의사, 경찰의 행동을 받아 결과 처리
  async processNightActions(
    roomId: string,
    actions: {
      mafiaActions?: { [userId: number]: number };
      doctorAction?: number;
      policeAction?: number;
    },
  ): Promise<any> {
    const gameData = await redisClient.get(`game:${roomId}`);
    if (!gameData) throw new Error('Game not found');
    let game: Game = JSON.parse(gameData);

    // 야간 행동 저장
    game.mafiaActions = actions.mafiaActions;
    game.doctorAction = actions.doctorAction;
    game.policeAction = actions.policeAction;

    // killResult: 객체 또는 null
    let killResult: {
      killed: boolean;
      reason?: string;
      target?: number;
    } | null = null;
    const mafiaTargets = game.mafiaActions
      ? Object.values(game.mafiaActions)
      : [];
    let target = mafiaTargets.length > 0 ? mafiaTargets[0] : null;
    if (target !== null) {
      if (game.doctorAction === target) {
        killResult = { killed: false, reason: 'protected' };
      } else {
        game.aliveIds = game.aliveIds.filter((id) => id !== target);
        game.deadIds.push(target);
        killResult = { killed: true, target };
      }
    }

    // policeResult: 객체 또는 null; role은 null 허용
    let policeResult: {
      inspected: boolean;
      role: 'mafia' | 'citizen' | 'police' | 'doctor' | null;
    } | null = null;
    if (game.policeAction) {
      const player = await this.getPlayerById(roomId, game.policeAction);
      if (player) {
        policeResult = {
          inspected: true,
          role: player.role !== undefined ? player.role : null,
        };
      }
    }

    await redisClient.set(`game:${roomId}`, JSON.stringify(game));
    return { killResult, policeResult, game };
  }

  // 낮 투표 기록 저장
  async recordVote(
    roomId: string,
    voterId: number,
    targetId: number,
  ): Promise<void> {
    const gameData = await redisClient.get(`game:${roomId}`);
    if (!gameData) throw new Error('Game not found');
    let game: Game = JSON.parse(gameData);
    if (!game.voteRecords) {
      game.voteRecords = [];
    }
    game.voteRecords.push({ voterId, targetId });
    await redisClient.set(`game:${roomId}`, JSON.stringify(game));
    console.log(`플레이어 ${voterId}가 ${targetId}에게 투표함.`);
  }

  // userId로 플레이어 정보 조회 (하드코딩된 목록 사용)
  async getPlayerById(roomId: string, userId: number): Promise<Player | null> {
    const players = await this.getPlayersForRoom(roomId);
    return players.find((p) => p.userId === userId) || null;
  }
}
