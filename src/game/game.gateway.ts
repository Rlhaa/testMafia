// src/game/game.gateway.ts
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { GameService } from './game.service';

@WebSocketGateway({
  namespace: 'game', // 클라이언트는 ws://localhost:3000/game 에 연결합니다.
})
export class GameGateway {
  @WebSocketServer()
  server: Server;

  constructor(private readonly gameService: GameService) {}

  //  방 모듈에서 10초 카운트 후 자동으로 전송하는
  //  ROOM:GAME_START 이벤트를 수신합니다.
  //  이벤트 페이로드에는 roomId와 gameId가 포함되어야 합니다.
  //  역할 분배를 수행하고 결과를 GAME:ROLES_ASSIGNED 이벤트로 브로드캐스트합니다.

  @SubscribeMessage('ROOM:GAME_START')
  async handleGameStart(
    @MessageBody() data: { roomId: string; gameId: string },
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    const { roomId, gameId } = data;
    if (!roomId || !gameId) {
      client.emit('error', { message: 'roomId와 gameId가 필요합니다.' });
      return;
    }
    try {
      const updatedPlayers = await this.gameService.assignRoles(roomId, gameId);
      // 해당 방(roomId)에 속한 모든 클라이언트에게 역할 분배 결과 전송
      this.server.to(roomId).emit('GAME:ROLES_ASSIGNED', {
        message: '역할 분배가 완료되었습니다.',
        players: updatedPlayers,
      });
    } catch (error) {
      client.emit('error', { message: error.message });
    }
  }
}
