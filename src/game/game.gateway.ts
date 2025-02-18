import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket, RemoteSocket } from 'socket.io';
import { DefaultEventsMap } from 'socket.io/dist/typed-events';
import { GameService } from './game.service';
import { RoomService } from '../room/room.service';

// GateWay 파일에서는 웹소켓 연결, 이벤트 구독 or 발행, 클라이언트와의 입출력에 집중

// 브라우저 >> HTTP 요청을 통해 단방향 통신 가능 >> 요청-응답 방식
// 웹소켓 >> 클라이언트(보통 브라우저)와 서버 간에 지속적인 양방향 통신 채널을 제공하는 프로토콜
// socket.io >> 소켓을 통해 클라이언트와 서버 간의 실시간 통신을 쉽게 구현할 수 있도록 도와주는 JS 라이브러리
// socket.io덕에 클라이언트가 HTTP/HTTPS URL을 사용해 연결해도, 초기 연결 후 내부적으로  WebSocket으로 업그레이드 되어
// 실제 통신은 웹소켓을 통해 이루어지게됨
@WebSocketGateway({
  // 웹소켓 게이트웨이로 선언하는 데코레이터
  namespace: 'room', // Socket.IO의 네임스페이스를 room으로 설정 >> 클라이언트는 해당 네임스페이스에 연결해야하고, 그 안에서 발행된 이벤트만 구독
})
export class GameGateway {
  @WebSocketServer()
  server: Server;

  constructor(
    private readonly gameService: GameService,
    private readonly roomService: RoomService,
  ) {}

  // ROOM:GAME_START 이벤트 처리
  // 클라이언트가 이 이벤트를 보내면, 서버는 인증 정보(auth)를 통해 roomId와 userId를 추출
  // 게임 생성 및 역할 분배를 실행하고, 방 내 소켓들에 대해 개별적으로 YOUR_ROLE 이벤트를 전송

  @SubscribeMessage('ROOM:GAME_START')
  async handleGameStart(@ConnectedSocket() client: Socket): Promise<void> {
    // 인증 정보(auth)에서 roomId와 userId 추출 (Socket.IO v4 기준)
    const roomId = client.handshake.auth.roomId as string;
    const userId = client.handshake.auth.userId as string;

    if (!roomId || !userId) {
      client.emit('error', { message: 'roomId와 userId가 필요합니다.' });
      return;
    }

    try {
      // 게임 생성 및 초기 상태 설정
      const gameId = await this.gameService.createGame(roomId);
      // 역할 분배 (플레이어 수 검증 후 역할 할당)
      const updatedPlayers = await this.gameService.assignRoles(roomId, gameId);

      // 방 전체에 공용 메시지 전송 (예: 안내 메시지)
      this.server.to(roomId).emit('message', {
        sender: 'system',
        message: '역할 분배가 완료되었습니다. 각자 자신의 역할을 확인하세요.',
      });

      // 방에 연결된 소켓들만 가져와서, 개별적으로 YOUR_ROLE 이벤트 전송
      const sockets: RemoteSocket<DefaultEventsMap, any>[] = await this.server
        .in(roomId)
        .fetchSockets();

      sockets.forEach((socket: RemoteSocket<DefaultEventsMap, any>) => {
        const socketUserId = socket.handshake.auth.userId as string;
        // 숫자로 변환하여 비교 (확실하게 일치시키기 위해)
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
      client.emit('error', { message: error.message });
    }
  }
}
