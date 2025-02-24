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
import { NightResultService } from 'src/notice/night-result.service';

interface Player {
  id: number;
  role?: string;
  isAlive?: boolean;
}

@Injectable()
export class RoomService {
  // 사용자ID - 그 사용자의 웹소켓ID 연결
  // ex) 사용자 ID가 1이고 소켓 ID가 "abc123"이라면, 이 매핑은 userSocketMap.set(1, "abc123")로 저장
  // 이후 서버에서 특정 사용자에게 메시지를 보내고 싶을 때, 해당 사용자의 ID를 통해 소켓 ID를 찾아 메시지를 전송
  private userSocketMap: Map<number, string> = new Map();

  // 각 방의 ID(문자열)를 해당 방의 게임 시작 타이머와 연결
  // ex)방 ID가 "1"이고, 타이머 객체가 setTimeout으로 생성된 경우,
  // 이 매핑은 roomCountdownTimers.set("1", timerObject)로 저장
  private roomCountdownTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(
    // 레디스 클라이언트 주입 받음
    @Inject('REDIS_CLIENT')
    private readonly redisClient: Redis,
    // 게임 관련 메서드 주입을 위해 GameService 주입 받음
    private readonly gameService: GameService,
    // [수정] NightResultService 주입: 모든 공지 처리를 이 서비스에서 담당
    private readonly nightResultService: NightResultService,
  ) {}

  // -------- 헬퍼함수 --------
  // 룸 id가 주어졌을 때 redis key 생성하는 메서드
  private getRedisKey(roomId: string): string {
    return `room:${roomId}`;
  }

  // 레디스에서 가져온 플레이어목록을 player 배열로 변환하는 메서드
  // 즉 현재 레디스에 존재하는 실시간 player 관련 정보를  필요로 할 때 쓰임
  private parsePlayers(playersData: string | undefined): Player[] {
    if (!playersData) return [];
    try {
      return JSON.parse(playersData) as Player[];
    } catch (error) {
      console.error('Failed to parse players JSON:', error);
      return [];
    }
  }

  // 시스템 메시지 전송 헬퍼
  // 지정된 룸id의 모든 클라이언트에세 시스템 메시지 전송
  sendSystemMessage(server: Server, roomId: string, message: string): void {
    server.to(roomId).emit('message', { sender: 'system', message });
  }
  // -------- 헬퍼함수 -------- 추후 다른 폴더에서 따로 관리해야하나?

  // getRoomInfo: Redis에서 roomId로 방 정보를 조회 후 객체로 반환
  async getRoomInfo(roomId: string): Promise<any> {
    // 인자(roomId) 없을 때 예외처리
    if (!roomId) {
      throw new BadRequestException('roomId가 필요합니다.');
    }
    // getRedisKey 헬퍼 함수로 방 ID에 대한 Redis 키를 반환, redisKey라는 변수에 할당
    const redisKey = this.getRedisKey(roomId);
    // hgetall 메서드는 해시 데이터 구조에서 모든 필드를 반환
    // redis 서버를 향한 네트웨크 요청을 포함하므로 요청 완료시 까지 대기 후 진행
    const roomData = await this.redisClient.hgetall(redisKey);

    // 조회된 데이터가 없거나 빈 객체인 경우 예외처리
    if (!roomData || Object.keys(roomData).length === 0) {
      throw new NotFoundException(`${roomId}방이 서버에 존재하지 않습니다.`);
    }

    // 최종적으로 구한 방 정보를 포함하는 객체를 반환
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
  async updateRoomPlayers(roomId: string, players: Player[]): Promise<void> {
    // 인자(roomId) 없을 때 예외처리
    if (!roomId) {
      throw new BadRequestException('roomId가 필요합니다.');
    }

    // getRedisKey 헬퍼 함수로 방 ID에 대한 Redis 키를 반환, redisKey라는 변수에 할당
    const redisKey = this.getRedisKey(roomId);
    // players 배열을 JSON 문자열로 변환후
    // redisClient.hset 메서드로 레디스의 players라는 필드에 저장
    await this.redisClient.hset(redisKey, 'players', JSON.stringify(players));
  }

  // addPlayer: 새로운 플레이어를 추가 (최대 8명, 중복 추가 방지)
  async addPlayer(roomId: string, newPlayer: Player): Promise<Player[]> {
    // getRoomInfo 메서드가 roomId로 방 정보를 조회 후 객체로 반환
    const roomData = await this.getRoomInfo(roomId);

    // parsePlayers 헬퍼 함수로 roomData의 players를 Player 배열로 변환
    const players: Player[] = this.parsePlayers(roomData.players);

    // 이때 현재 플레이어 수가 8명 이상인 경우 예외 처리
    if (players.length >= 8) {
      throw new BadRequestException('방 최대 인원에 도달했습니다.');
    }

    // find로 newPlayer의 id가 플레이어 목록에 이미 존재하는지 확인 후
    // 없다면 새로운 플레이어 배열에 추가
    if (!players.find((p) => p.id === newPlayer.id)) {
      players.push(newPlayer);
    }

    // updateRoomPlayers 메서드를 호출해 새로운 players 정보를 redis에 저장
    await this.updateRoomPlayers(roomId, players);

    // 이후 클라이언트 단에서 현재 방에 있는 유저 정보를 띄우기 위해 최종적으로 반환
    return players;
  }

  // prepareGame: 게임 생성 및 역할 분배 후 각 소켓에 YOUR_ROLE 이벤트 전송
  async prepareGame(server: Server, roomId: string): Promise<void> {
    try {
      await this.gameService.createGame(roomId);

      const gameId = await this.gameService.getCurrentGameId(roomId);
      if (!gameId) {
        throw new BadRequestException('게임 ID를 찾을 수 없습니다.');
      }

      const updatedPlayers = await this.gameService.assignRoles(roomId, gameId);

      // [수정] 기존 sendSystemMessage 대신 NightResultService의 announceSystemMessage 사용
      this.nightResultService.announceSystemMessage(
        roomId,
        '마스터가 직업을 분배중입니다. 당신의 직업은...',
      );

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

  getUserSocketMap(userId: number) {
    return this.userSocketMap.get(userId);
  }
  // joinRoom: 클라이언트의 방 입장 및 관련 비즈니스 로직 실행
  // 서버 인스턴스, 클라이언트 소켓, 방 ID, 사용자 ID를 매개변수로 받음
  async joinRoom(
    server: Server,
    client: Socket,
    roomId: string,
    userId: number,
  ): Promise<void> {
    // roomId 또는 userId가 제공되지 않은 경우 예외처리
    if (!roomId || !userId) {
      client.emit('error', { message: 'roomId와 userId가 필요합니다.' });
      return;
    }

    // 중복 접속 확인: 동일한 userId가 이미 연결되어 있다면 기존 소켓 종료
    // userId: 42가 접속했다면 userSocketMap에 { 42: 'socket_001' }와 연결되어있는 상태
    // userId: 42가 다시한번 접속하여 joinroom 이벤트가 발생한다면 조건문 조건 true >> 조건문에 걸림
    if (this.userSocketMap.has(userId)) {
      // this.userSocketMap.get(42)를 호출하여, 이전에 저장된 소켓 ID인 'socket_001'을 가져옴
      const previousSocketId = this.getUserSocketMap(userId)!;

      // 서버의 소켓 목록에서 server.sockets.sockets.get('socket_001')를 통해 실제 소켓 객체 찾음
      const previousSocket = server.sockets.sockets.get(previousSocketId);

      // 찾았을 때 있다면, 오류 메시지 전송 후 해당 소켓 disconnect
      // >> 새롭게 접속한 연결만 유지 (현재 구동 X로 확인)
      if (previousSocket) {
        previousSocket.emit('error', {
          message: '중복 접속으로 인해 연결이 종료되었습니다.',
        });
        previousSocket.disconnect();
      }
    }

    // 플레이어 추가 (최대 8명 제한 적용)
    try {
      // 상위 조건문에 걸리지 않으면, addPlayer메서드로 새로운 플레이어 추가
      await this.addPlayer(roomId, { id: userId });
    } catch (error: any) {
      client.emit('error', { message: error.message });
      return;
    }

    // 클라이언트를 해당 방에 입장시키고 userSocketMap에 소켓 매핑 정보를 저장
    client.join(roomId);
    this.userSocketMap.set(userId, client.id);
    // [수정] 접속 공지: 기존 sendSystemMessage 대신 NightResultService의 announceJoinRoom 호출
    this.nightResultService.announceJoinRoom(roomId, userId);

    // 접속 처리 후 최신 방 정보 조회 하여 ROOM:UPDATED 이벤트 전송
    const roomData = await this.getRoomInfo(roomId);
    server.to(roomId).emit('ROOM:UPDATED', roomData);

    // 방 내 소켓 수 확인: joinroom 이후 현재 유저가 8명이면 게임 자동 시작 타이머 설정
    const sockets = await server.in(roomId).allSockets();
    if (sockets.size === 8 && !this.roomCountdownTimers.has(roomId)) {
      const timer = setTimeout(async () => {
        await this.prepareGame(server, roomId);
        this.roomCountdownTimers.delete(roomId);
      }, 10000);
      this.roomCountdownTimers.set(roomId, timer);
      // [수정] 방 꽉 참 공지: NightResultService의 announceRoomFull 호출
      this.nightResultService.announceRoomFull(roomId);
    }
  }

  // leaveRoom: 클라이언트의 방 퇴장 및 관련 처리
  async leaveRoom(
    server: Server,
    client: Socket,
    roomId: string,
    userId: number,
  ): Promise<void> {
    // leave 메서드로 지정된 룸(roomId를 통해)에서 클라이언트 제거
    client.leave(roomId);
    // 매핑도 삭제
    this.userSocketMap.delete(userId);
    // [수정] 퇴장 공지: 기존 sendSystemMessage 대신 NightResultService의 announceLeaveRoom 호출
    this.nightResultService.announceLeaveRoom(roomId, userId);

    // 제거 처리 후 현재 방 인원 업데이트 로직
    // 현재 방 정보 조회
    let roomData = await this.getRoomInfo(roomId);
    // 그 방 정보의 플레이어 정보를 배열로 파싱하는 parsePlayers 헬퍼함수로 배열화 하고
    // playersArray에 저장
    let playersArray: Player[] = this.parsePlayers(roomData.players);
    // playersArray에 퇴장한 유저의 userId와 일치하지 않는 플레이어만 배열에 업데이트
    // >> 나간 사람 빼고, 남아있는 사람의 userId 배열 생성
    playersArray = playersArray.filter((p) => p.id !== userId);
    // 현재상태를 반영한 playersArray를 redis에 저장
    await this.updateRoomPlayers(roomId, playersArray);

    // 위 과정에서 갱신된 룸 데이터를 불러오고
    roomData = await this.getRoomInfo(roomId);
    // 클라이언트에 ROOM:UPDATED를 발생시켜 최신정보를 전송
    server.to(roomId).emit('ROOM:UPDATED', roomData);

    // 만약 방 인원이 8명 미만이면 진행 중인 게임 시작 타이머 취소
    const sockets = await server.in(roomId).allSockets();
    if (sockets.size < 8 && this.roomCountdownTimers.has(roomId)) {
      const timer = this.roomCountdownTimers.get(roomId)!;
      clearTimeout(timer);
      this.roomCountdownTimers.delete(roomId);
      // [수정] 타이머 취소 공지: 기존 sendSystemMessage 대신 NightResultService의 announceCancelTimer 호출
      this.nightResultService.announceCancelTimer(roomId);
    }
  }
}
