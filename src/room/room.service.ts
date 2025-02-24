import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Inject,
} from '@nestjs/common';
import { Redis } from 'ioredis';
import { Server, Socket, RemoteSocket } from 'socket.io';
import { DefaultEventsMap } from 'socket.io/dist/typed-events';
import { GameService } from '../game/game.service';

// 플레이어 객체 구조 정의
interface Player {
  id: number;
  role?: string;
  isAlive?: boolean;
}

@Injectable()
export class RoomService {
  // ──────────────────────────────
  // 내부 맵: 사용자 소켓 및 방 타이머 관리
  // ──────────────────────────────
  private userSocketMap: Map<number, string> = new Map();
  private roomCountdownTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(
    @Inject('REDIS_CLIENT')
    private readonly redisClient: Redis,
    private readonly gameService: GameService,
  ) {}

  // ──────────────────────────────
  // 헬퍼/유틸리티 메서드
  // ──────────────────────────────

  // Redis 키 생성: room:{roomId}
  private getRedisKey(roomId: string): string {
    return `room:${roomId}`;
  }

  // Redis에 저장된 플레이어 목록 JSON 문자열을 파싱하여 Player[] 반환
  private parsePlayers(playersData: string | undefined): Player[] {
    if (!playersData) return [];
    try {
      return JSON.parse(playersData) as Player[];
    } catch (error) {
      console.error('Failed to parse players JSON:', error);
      return [];
    }
  }

  // 시스템 메시지 전송: 지정된 방의 모든 클라이언트에 'message' 이벤트 발행
  sendSystemMessage(server: Server, roomId: string, message: string): void {
    server.to(roomId).emit('message', { sender: 'system', message });
  }

  // ──────────────────────────────
  // 방 정보 조회 및 업데이트
  // ──────────────────────────────

  // Redis에서 roomId로 방 정보를 조회 후 객체로 반환
  async getRoomInfo(roomId: string): Promise<any> {
    if (!roomId) {
      throw new BadRequestException('roomId가 필요합니다.');
    }
    const redisKey = this.getRedisKey(roomId);
    const roomData = await this.redisClient.hgetall(redisKey);
    if (!roomData || Object.keys(roomData).length === 0) {
      throw new NotFoundException(`${roomId}방이 서버에 존재하지 않습니다.`);
    }
    return {
      id: roomData.id,
      hostId: roomData.hostId,
      roomName: roomData.roomName,
      status: roomData.status,
      mode: roomData.mode,
      locked: roomData.locked === 'true',
      password: roomData.password,
      createdAt: roomData.createdAt,
      players: roomData.players,
    };
  }

  // 플레이어 목록을 Redis에 JSON 문자열로 저장
  async updateRoomPlayers(roomId: string, players: Player[]): Promise<void> {
    if (!roomId) {
      throw new BadRequestException('roomId가 필요합니다.');
    }
    const redisKey = this.getRedisKey(roomId);
    await this.redisClient.hset(redisKey, 'players', JSON.stringify(players));
  }

  // ──────────────────────────────
  // 플레이어 관리 메서드
  // ──────────────────────────────

  // 새로운 플레이어를 추가 (최대 8명, 중복 추가 방지)
  async addPlayer(roomId: string, newPlayer: Player): Promise<Player[]> {
    const roomData = await this.getRoomInfo(roomId);
    const players: Player[] = this.parsePlayers(roomData.players);
    if (players.length >= 8) {
      throw new BadRequestException('방 최대 인원에 도달했습니다.');
    }
    if (!players.find((p) => p.id === newPlayer.id)) {
      players.push(newPlayer);
    }
    await this.updateRoomPlayers(roomId, players);
    return players;
  }

  // ──────────────────────────────
  // 게임 준비 및 진행 메서드
  // ──────────────────────────────

  // prepareGame: 게임 생성 및 역할 분배 후 각 소켓에 YOUR_ROLE 이벤트 전송, 낮 단계 시작
  async prepareGame(server: Server, roomId: string): Promise<void> {
    try {
      // 게임 생성
      await this.gameService.createGame(roomId);
      const gameId = await this.gameService.getCurrentGameId(roomId);
      if (!gameId) {
        throw new BadRequestException('게임 ID를 찾을 수 없습니다.');
      }
      // 역할 분배
      const updatedPlayers = await this.gameService.assignRoles(roomId, gameId);
      this.sendSystemMessage(
        server,
        roomId,
        '마스터가 직업을 분배중입니다. 당신의 직업은...',
      );

      // 각 클라이언트에 YOUR_ROLE 이벤트 전송
      const sockets = await server.in(roomId).fetchSockets();
      sockets.forEach((socket: RemoteSocket<DefaultEventsMap, any>) => {
        const socketUserId = socket.handshake.auth.userId as string;
        const player = updatedPlayers.find(
          (p: Player) => Number(p.id) === Number(socketUserId),
        );
        if (player) {
          setTimeout(() => {
            socket.emit('YOUR_ROLE', {
              message: `${player.role} 입니다!`,
              role: player.role,
            });
          }, 3000);
        }
      });

      // 낮 단계 시작 후 메시지 전송
      setTimeout(async () => {
        const newDay = await this.gameService.startDayPhase(roomId, gameId);
        server.to(roomId).emit('message', {
          sender: 'system',
          message: `Day ${newDay} 낮이 밝았습니다!`,
        });
      }, 6000);
    } catch (error: any) {
      server.to(roomId).emit('error', { message: error.message });
    }
  }

  // joinRoom: 클라이언트의 방 입장 및 관련 로직 처리
  async joinRoom(
    server: Server,
    client: Socket,
    roomId: string,
    userId: number,
  ): Promise<void> {
    if (!roomId || !userId) {
      client.emit('error', { message: 'roomId와 userId가 필요합니다.' });
      return;
    }

    // 중복 접속 확인: 동일 userId가 이미 연결되어 있으면 기존 소켓 종료
    if (this.userSocketMap.has(userId)) {
      const previousSocketId = this.userSocketMap.get(userId)!;
      const previousSocket = server.sockets.sockets.get(previousSocketId);
      if (previousSocket) {
        previousSocket.emit('error', {
          message: '중복 접속으로 인해 연결이 종료되었습니다.',
        });
        previousSocket.disconnect();
      }
    }

    // 플레이어 추가
    try {
      await this.addPlayer(roomId, { id: userId });
    } catch (error: any) {
      client.emit('error', { message: error.message });
      return;
    }

    // 클라이언트 방 입장 및 소켓 매핑 업데이트
    client.join(roomId);
    this.userSocketMap.set(userId, client.id);
    this.sendSystemMessage(
      server,
      roomId,
      `${userId}번 유저가 ${roomId}번 방에 접속하였습니다.`,
    );

    // 최신 방 정보 조회 후 ROOM:UPDATED 이벤트 전송
    const roomData = await this.getRoomInfo(roomId);
    server.to(roomId).emit('ROOM:UPDATED', roomData);

    // 방 인원이 8명이면 게임 자동 시작 타이머 설정
    const sockets = await server.in(roomId).allSockets();
    if (sockets.size === 8 && !this.roomCountdownTimers.has(roomId)) {
      const timer = setTimeout(async () => {
        await this.prepareGame(server, roomId);
        this.roomCountdownTimers.delete(roomId);
      }, 10000);
      this.roomCountdownTimers.set(roomId, timer);
      this.sendSystemMessage(
        server,
        roomId,
        '방이 꽉 찼습니다. 10초 후 게임이 시작됩니다.',
      );
    }
  }

  // leaveRoom: 클라이언트의 방 퇴장 및 관련 처리
  async leaveRoom(
    server: Server,
    client: Socket,
    roomId: string,
    userId: number,
  ): Promise<void> {
    client.leave(roomId);
    this.userSocketMap.delete(userId);
    this.sendSystemMessage(
      server,
      roomId,
      `${userId}번이 ${roomId}번방에서 나갔습니다.`,
    );

    // 방의 플레이어 목록 업데이트
    let roomData = await this.getRoomInfo(roomId);
    let playersArray: Player[] = this.parsePlayers(roomData.players);
    playersArray = playersArray.filter((p) => p.id !== userId);
    await this.updateRoomPlayers(roomId, playersArray);

    roomData = await this.getRoomInfo(roomId);
    server.to(roomId).emit('ROOM:UPDATED', roomData);

    // 인원이 8명 미만이면 진행 중인 게임 시작 타이머 취소
    const sockets = await server.in(roomId).allSockets();
    if (sockets.size < 8 && this.roomCountdownTimers.has(roomId)) {
      const timer = this.roomCountdownTimers.get(roomId)!;
      clearTimeout(timer);
      this.roomCountdownTimers.delete(roomId);
      this.sendSystemMessage(
        server,
        roomId,
        '인원이 줄어들어 게임 시작 타이머가 취소되었습니다.',
      );
    }
  }
}
