import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket, RemoteSocket } from 'socket.io';
import { DefaultEventsMap } from 'socket.io/dist/typed-events';
import { GameService } from '../game/game.service';
import { RoomService } from '../room/room.service';

@WebSocketGateway({
  namespace: 'room',
})
export class RoomGateway {
  @WebSocketServer()
  server: Server;

  constructor(
    private readonly gameService: GameService,
    private readonly roomService: RoomService,
  ) {}

  // In-memory mapping: userId -> socketId (테스트용)
  private userSocketMap: Map<number, string> = new Map();
  // 방별 게임 시작 타이머 관리 (roomId -> Timeout)
  private roomCountdownTimers: Map<string, NodeJS.Timeout> = new Map();

  @SubscribeMessage('joinRoom')
  async handleJoinRoom(
    @MessageBody() data: { roomId: string; userId: number },
    @ConnectedSocket() client: Socket,
  ) {
    const { roomId, userId } = data;
    if (!roomId || !userId) {
      client.emit('error', { message: 'roomId와 userId가 필요합니다.' });
      return;
    }

    // 플레이어 추가 (RoomService를 통해 최대 인원 제한 적용)
    try {
      await this.roomService.addPlayer(roomId, { id: userId });
    } catch (error) {
      client.emit('error', { message: error.message });
      return;
    }

    client.join(roomId);
    this.userSocketMap.set(userId, client.id);
    this.server.to(roomId).emit('message', {
      sender: 'system',
      message: `User ${userId} has joined room ${roomId}.`,
    });

    // 최신 방 정보 전달
    const roomData = await this.roomService.getRoomInfo(roomId);
    client.emit('ROOM:JOINED', roomData);

    // 방 내 소켓 수 확인 및 자동 게임 시작 타이머 설정
    const sockets = await this.server.in(roomId).allSockets();
    if (sockets.size === 8 && !this.roomCountdownTimers.has(roomId)) {
      const timer = setTimeout(async () => {
        await this.startGame(roomId); // 클라이언트 재전송 없이 바로 실행
        this.roomCountdownTimers.delete(roomId);
      }, 10000);
      this.roomCountdownTimers.set(roomId, timer);
      this.server.to(roomId).emit('message', {
        sender: 'system',
        message: '방이 꽉 찼습니다. 10초 후 게임이 시작됩니다.',
      });
    }
  }

  @SubscribeMessage('leaveRoom')
  async handleLeaveRoom(
    @MessageBody() data: { roomId: string; userId: number },
    @ConnectedSocket() client: Socket,
  ) {
    const { roomId, userId } = data;
    client.leave(roomId);
    this.userSocketMap.delete(userId);
    this.server.to(roomId).emit('message', {
      sender: 'system',
      message: `User ${userId} has left room ${roomId}.`,
    });

    // 플레이어 목록 업데이트 (플레이어 제거)
    let roomData = await this.roomService.getRoomInfo(roomId);
    let playersArray: { id: number }[] = [];
    try {
      playersArray = roomData.players ? JSON.parse(roomData.players) : [];
    } catch (error) {
      console.error('JSON 파싱 실패:', error);
      playersArray = [];
    }
    playersArray = playersArray.filter((p) => p.id !== userId);
    await this.roomService.updateRoomPlayers(roomId, playersArray);

    // 최신 방 정보 전달
    roomData = await this.roomService.getRoomInfo(roomId);
    client.emit('ROOM:JOINED', roomData);

    // 소켓 수 확인 및 게임 시작 타이머 취소
    const sockets = await this.server.in(roomId).allSockets();
    if (sockets.size < 8 && this.roomCountdownTimers.has(roomId)) {
      const timer = this.roomCountdownTimers.get(roomId);
      clearTimeout(timer);
      this.roomCountdownTimers.delete(roomId);
      this.server.to(roomId).emit('message', {
        sender: 'system',
        message: '인원이 줄어들어 게임 시작 타이머가 취소되었습니다.',
      });
    }
  }

  // startGame 메서드: 서버가 자동으로 게임 생성 및 역할 분배를 실행
  private async startGame(roomId: string): Promise<void> {
    try {
      const gameId = await this.gameService.createGame(roomId);
      const updatedPlayers = await this.gameService.assignRoles(roomId, gameId);

      // 안내 메시지 전송
      this.server.to(roomId).emit('message', {
        sender: 'system',
        message: '역할 분배가 완료되었습니다. 각자 자신의 역할을 확인하세요.',
      });

      // 방에 연결된 소켓들에 대해 YOUR_ROLE 이벤트 개별 전송
      const sockets: RemoteSocket<DefaultEventsMap, any>[] = await this.server
        .in(roomId)
        .fetchSockets();

      sockets.forEach((socket: RemoteSocket<DefaultEventsMap, any>) => {
        const socketUserId = socket.handshake.auth.userId as string;
        const player = updatedPlayers.find(
          (p) => Number(p.id) === Number(socketUserId),
        );
        if (player) {
          socket.emit('YOUR_ROLE', {
            message: `당신의 역할은 ${player.role} 입니다.`,
            role: player.role,
          });
        }
      });
    } catch (error) {
      this.server.to(roomId).emit('error', { message: error.message });
    }
  }
}
