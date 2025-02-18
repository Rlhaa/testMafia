import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  ConnectedSocket,
  MessageBody,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket, RemoteSocket } from 'socket.io';
import { DefaultEventsMap } from 'socket.io/dist/typed-events';
import { GameService } from '../game/game.service';
import { RoomService } from './room.service';

@WebSocketGateway({
  namespace: 'room', // 클라이언트는 http://localhost:3000/room으로 연결
})
export class RoomGateway implements OnGatewayDisconnect {
  @WebSocketServer()
  server: Server; // Socket.IO 서버 인스턴스

  constructor(
    private readonly gameService: GameService, // 게임 관련 비즈니스 로직 호출
    private readonly roomService: RoomService, // 방 정보 관리
  ) {}

  private userSocketMap: Map<number, string> = new Map(); // in-memory: userId -> socketId
  private roomCountdownTimers: Map<string, NodeJS.Timeout> = new Map(); // 방별 게임 시작 타이머

  @SubscribeMessage('chatMessage')
  handleChatMessage(
    @MessageBody() data: { roomId: string; userId: number; message: string },
    @ConnectedSocket() client: Socket,
  ) {
    // 수신한 메시지를 해당 방에 있는 모든 클라이언트에게 브로드캐스트
    this.server.to(data.roomId).emit('message', {
      sender: data.userId,
      message: data.message,
    });
  }

  // joinRoom 이벤트 처리
  // - 클라이언트가 방에 입장할 때 호출됩니다.
  // - RoomService.addPlayer를 통해 플레이어 추가(최대 8명 제한) 후 최신 방 정보를 모든 클라이언트에 ROOM:UPDATED로 전송합니다.
  // - 방 인원이 8명에 도달하면 10초 타이머를 설정하여 자동으로 startGame()을 호출합니다.
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

    // 중복 접속 확인: 이미 같은 userId가 연결되어 있다면 이전 소켓 종료
    if (this.userSocketMap.has(userId)) {
      const previousSocketId = this.userSocketMap.get(userId)!; // non-null assertion
      const previousSocket = this.server.sockets.sockets.get(previousSocketId);
      if (previousSocket) {
        previousSocket.emit('error', {
          message: '중복 접속으로 인해 연결이 종료되었습니다.',
        });
        previousSocket.disconnect();
      }
    }

    // 플레이어 추가 (최대 8명 제한 적용)
    try {
      await this.roomService.addPlayer(roomId, { id: userId });
    } catch (error) {
      client.emit('error', { message: error.message });
      return;
    }

    client.join(roomId); // 클라이언트를 해당 방에 join
    this.userSocketMap.set(userId, client.id); // in-memory 매핑 업데이트
    this.server.to(roomId).emit('message', {
      sender: 'system',
      message: `${userId}번 유저가 ${roomId}번 방에 접속하였습니다.`,
    });

    // 최신 방 정보 조회 후 모든 클라이언트에 ROOM:UPDATED 이벤트 전송
    const roomData = await this.roomService.getRoomInfo(roomId);
    this.server.to(roomId).emit('ROOM:UPDATED', roomData);

    // 방 내 소켓 수 확인 및 자동 게임 시작 타이머 설정
    const sockets = await this.server.in(roomId).allSockets();
    if (sockets.size === 8 && !this.roomCountdownTimers.has(roomId)) {
      const timer = setTimeout(async () => {
        await this.startGame(roomId); // 10초 후 자동 게임 시작
        this.roomCountdownTimers.delete(roomId);
      }, 10000);
      this.roomCountdownTimers.set(roomId, timer);
      this.server.to(roomId).emit('message', {
        sender: 'system',
        message: '방이 꽉 찼습니다. 10초 후 게임이 시작됩니다.',
      });
    }
  }

  // leaveRoom 이벤트 처리 (클라이언트가 명시적으로 방을 나갈 때)
  @SubscribeMessage('leaveRoom')
  async handleLeaveRoom(
    @MessageBody() data: { roomId: string; userId: number },
    @ConnectedSocket() client: Socket,
  ) {
    await this.performLeaveRoom(data.roomId, data.userId, client);
  }

  // 연결 종료(Disconnect) 처리 (브라우저 종료 등)
  async handleDisconnect(client: Socket) {
    const roomId = client.handshake.auth.roomId as string;
    const userId = client.handshake.auth.userId as number;
    await this.performLeaveRoom(roomId, userId, client);
  }

  // 공통 leaveRoom 로직
  // - 클라이언트가 방을 나가면 해당 플레이어를 Redis에서 제거하고 최신 방 정보를 모든 클라이언트에 ROOM:UPDATED 이벤트로 전송합니다.
  // - 8명 미만이 되면 진행 중인 게임 시작 타이머를 취소합니다.
  private async performLeaveRoom(
    roomId: string,
    userId: number,
    client: Socket,
  ) {
    client.leave(roomId); // 방에서 클라이언트 제거
    this.userSocketMap.delete(userId); // in-memory 매핑 삭제
    this.server.to(roomId).emit('message', {
      sender: 'system',
      message: `${userId}번이 ${roomId}번방에서 나갔습니다.`,
    });

    let roomData = await this.roomService.getRoomInfo(roomId); // 최신 방 정보 조회
    let playersArray: { id: number }[] = [];
    try {
      playersArray = roomData.players ? JSON.parse(roomData.players) : [];
    } catch (error) {
      console.error('JSON 파싱 실패:', error);
      playersArray = [];
    }
    playersArray = playersArray.filter((p) => p.id !== userId); // 해당 플레이어 제거
    await this.roomService.updateRoomPlayers(roomId, playersArray); // Redis 업데이트

    roomData = await this.roomService.getRoomInfo(roomId); // 최신 정보 재조회
    this.server.to(roomId).emit('ROOM:UPDATED', roomData); // 최신 방 정보 브로드캐스트

    const sockets = await this.server.in(roomId).allSockets();
    if (sockets.size < 8 && this.roomCountdownTimers.has(roomId)) {
      const timer = this.roomCountdownTimers.get(roomId);
      clearTimeout(timer); // 타이머 취소
      this.roomCountdownTimers.delete(roomId);
      this.server.to(roomId).emit('message', {
        sender: 'system',
        message: '인원이 줄어들어 게임 시작 타이머가 취소되었습니다.',
      });
    }
  }

  // startGame
  // - 서버가 자동으로 게임 생성 및 역할 분배를 실행합니다.
  // - GameService를 호출하여 게임 생성과 역할 분배를 수행한 후, 방에 연결된 각 소켓에 YOUR_ROLE 이벤트를 전송합니다.
  private async startGame(roomId: string): Promise<void> {
    try {
      const gameId = await this.gameService.createGame(roomId); // 게임 생성
      const updatedPlayers = await this.gameService.assignRoles(roomId, gameId); // 역할 분배

      this.server.to(roomId).emit('message', {
        sender: 'system',
        message: '마스터가 직업을 분배중입니다. 당신의 직업은...',
      });

      const sockets: RemoteSocket<DefaultEventsMap, any>[] = await this.server
        .in(roomId)
        .fetchSockets();

      sockets.forEach((socket: RemoteSocket<DefaultEventsMap, any>) => {
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
          }, 3000); // 3초 후 YOUR_ROLE 이벤트 전송
        }
      });
    } catch (error) {
      this.server.to(roomId).emit('error', { message: error.message });
    }
  }
}
