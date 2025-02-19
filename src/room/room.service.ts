import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Inject,
} from '@nestjs/common';
import { Redis } from 'ioredis';
import { GameService } from '../game/game.service';

@Injectable()
export class RoomService {
  // in-memory 매핑: userId -> socketId
  private userSocketMap: Map<number, string> = new Map();
  // 방별 게임 시작 타이머
  private roomCountdownTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(
    @Inject('REDIS_CLIENT')
    private readonly redisClient: Redis,
    private readonly gameService: GameService,
  ) {}

  // getRoomInfo: Redis에서 방 정보를 조회 후 객체로 반환
  async getRoomInfo(roomId: string): Promise<any> {
    if (!roomId) {
      throw new BadRequestException('roomId가 필요합니다.');
    }
    const redisKey = `room:${roomId}`;
    const roomData = await this.redisClient.hgetall(redisKey);
    if (!roomData || Object.keys(roomData).length === 0) {
      throw new NotFoundException(`Room ${roomId} not found`);
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

  // updateRoomPlayers: 플레이어 목록을 Redis에 JSON 문자열로 저장
  async updateRoomPlayers(
    roomId: string,
    players: { id: number }[],
  ): Promise<void> {
    if (!roomId) {
      throw new BadRequestException('roomId가 필요합니다.');
    }
    const redisKey = `room:${roomId}`;
    await this.redisClient.hset(redisKey, 'players', JSON.stringify(players));
  }

  // addPlayer: 새로운 플레이어를 추가 (최대 8명, 중복 추가 방지)
  async addPlayer(
    roomId: string,
    newPlayer: { id: number },
  ): Promise<{ id: number }[]> {
    const roomData = await this.getRoomInfo(roomId);
    let players: { id: number }[] = [];
    try {
      players = roomData.players ? JSON.parse(roomData.players) : [];
    } catch (error) {
      players = [];
    }
    if (players.length >= 8) {
      throw new BadRequestException('방 최대 인원에 도달했습니다.');
    }
    if (!players.find((p) => p.id === newPlayer.id)) {
      players.push(newPlayer);
    }
    await this.updateRoomPlayers(roomId, players);
    return players;
  }

  // joinRoom: 클라이언트의 방 입장 및 관련 비즈니스 로직 실행
  async joinRoom(
    server: any,
    client: any,
    roomId: string,
    userId: number,
  ): Promise<void> {
    if (!roomId || !userId) {
      client.emit('error', { message: 'roomId와 userId가 필요합니다.' });
      return;
    }

    // 중복 접속 확인: 동일한 userId가 이미 연결되어 있다면 기존 소켓 종료
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

    // 플레이어 추가 (최대 8명 제한 적용)
    try {
      await this.addPlayer(roomId, { id: userId });
    } catch (error) {
      client.emit('error', { message: error.message });
      return;
    }

    client.join(roomId);
    this.userSocketMap.set(userId, client.id);
    server.to(roomId).emit('message', {
      sender: 'system',
      message: `${userId}번 유저가 ${roomId}번 방에 접속하였습니다.`,
    });

    // 최신 방 정보 조회 후 ROOM:UPDATED 이벤트 전송
    const roomData = await this.getRoomInfo(roomId);
    server.to(roomId).emit('ROOM:UPDATED', roomData);

    // 방 내 소켓 수 확인: 8명이면 10초 후 게임 자동 시작 타이머 설정
    const sockets = await server.in(roomId).allSockets();
    if (sockets.size === 8 && !this.roomCountdownTimers.has(roomId)) {
      const timer = setTimeout(async () => {
        await this.startGame(server, roomId);
        this.roomCountdownTimers.delete(roomId);
      }, 10000);
      this.roomCountdownTimers.set(roomId, timer);
      server.to(roomId).emit('message', {
        sender: 'system',
        message: '방이 꽉 찼습니다. 10초 후 게임이 시작됩니다.',
      });
    }
  }

  // leaveRoom: 클라이언트의 방 퇴장 및 관련 처리
  async leaveRoom(
    server: any,
    client: any,
    roomId: string,
    userId: number,
  ): Promise<void> {
    client.leave(roomId);
    this.userSocketMap.delete(userId);
    server.to(roomId).emit('message', {
      sender: 'system',
      message: `${userId}번이 ${roomId}번방에서 나갔습니다.`,
    });

    let roomData = await this.getRoomInfo(roomId);
    let playersArray: { id: number }[] = [];
    try {
      playersArray = roomData.players ? JSON.parse(roomData.players) : [];
    } catch (error) {
      console.error('JSON 파싱 실패:', error);
      playersArray = [];
    }
    playersArray = playersArray.filter((p) => p.id !== userId);
    await this.updateRoomPlayers(roomId, playersArray);

    roomData = await this.getRoomInfo(roomId);
    server.to(roomId).emit('ROOM:UPDATED', roomData);

    // 만약 방 인원이 8명 미만이 되어 게임 시작 타이머가 진행 중이면 취소
    const sockets = await server.in(roomId).allSockets();
    if (sockets.size < 8 && this.roomCountdownTimers.has(roomId)) {
      const timer = this.roomCountdownTimers.get(roomId);
      clearTimeout(timer);
      this.roomCountdownTimers.delete(roomId);
      server.to(roomId).emit('message', {
        sender: 'system',
        message: '인원이 줄어들어 게임 시작 타이머가 취소되었습니다.',
      });
    }
  }

  // startGame: 게임 생성 및 역할 분배 후 각 소켓에 YOUR_ROLE 이벤트 전송
  async startGame(server: any, roomId: string): Promise<void> {
    try {
      const gameId = await this.gameService.createGame(roomId);
      const updatedPlayers = await this.gameService.assignRoles(roomId, gameId);

      server.to(roomId).emit('message', {
        sender: 'system',
        message: '마스터가 직업을 분배중입니다. 당신의 직업은...',
      });

      // 방에 연결된 각 소켓에 3초 후 YOUR_ROLE 이벤트 전송
      const sockets = await server.in(roomId).fetchSockets();
      sockets.forEach((socket: any) => {
        const socketUserId = socket.handshake.auth.userId as string;
        const player = updatedPlayers.find(
          (p) => Number(p.id) === Number(socketUserId),
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
    } catch (error) {
      server.to(roomId).emit('error', { message: error.message });
    }
  }
}
