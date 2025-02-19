import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  ConnectedSocket,
  MessageBody,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { GameService } from '../game/game.service';
import { RoomService } from './room.service';

@WebSocketGateway({
  namespace: 'room', // 현재 단계에서 네임스페이스를 구성할 필요가 크진 않지만, 일단 이렇게 따로 웹소켓 통신 공간을 지정 가능
})
export class RoomGateway implements OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  constructor(
    private readonly gameService: GameService,
    private readonly roomService: RoomService,
  ) {}
  // @SubscribeMessage 데코레이터로 클라이언트에서 발행한 특정 이벤트를 구독할 수 있다.
  @SubscribeMessage('chatMessage')
  handleChatMessage(
    @MessageBody() data: { roomId: string; userId: number; message: string },
    @ConnectedSocket() client: Socket,
  ) {
    // 채팅 메시지를 해당 방의 모든 클라이언트에게 브로드캐스트
    this.server.to(data.roomId).emit('message', {
      sender: data.userId,
      message: data.message,
    });
  }

  // joinRoom 이벤트: 룸 서비스의 joinRoom() 호출 >> 추후 이벤트 네임 변경 할 수 있음(웹소켓 명세 따라)
  @SubscribeMessage('joinRoom')
  async handleJoinRoom(
    @MessageBody() data: { roomId: string; userId: number },
    @ConnectedSocket() client: Socket,
  ) {
    const { roomId, userId } = data;
    await this.roomService.joinRoom(this.server, client, roomId, userId);
  }

  // leaveRoom 이벤트: 룸 서비스의 leaveRoom() 호출
  @SubscribeMessage('leaveRoom')
  async handleLeaveRoom(
    @MessageBody() data: { roomId: string; userId: number },
    @ConnectedSocket() client: Socket,
  ) {
    await this.roomService.leaveRoom(
      this.server,
      client,
      data.roomId,
      data.userId,
    );
  }
  // 명시적으로 SubscribeMessage를 통해 이벤트를 구독하지는 않지만
  // NestJS가 제공하는 OnGatewayDisconnect 인터페이스를 구현함으로써
  // 웹소켓 연결 종료(탈출) 이벤트를 자동으로 감지하고 호출
  // 즉, 게이트웨이 코드에 있는게 적절하다
  // 연결 종료 시에도 leaveRoom 로직 실행
  async handleDisconnect(client: Socket) {
    const roomId = client.handshake.auth.roomId as string;
    const userId = client.handshake.auth.userId as number;
    await this.roomService.leaveRoom(this.server, client, roomId, userId);
  }
}
