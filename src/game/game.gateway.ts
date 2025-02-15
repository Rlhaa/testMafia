// src/game/game.gateway.ts
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { GameService } from './game.service';
import { Player } from './models/player.model';

@WebSocketGateway({
  cors: { origin: '*' },
})
export class GameGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  constructor(private readonly gameService: GameService) {}

  handleConnection(client: Socket) {
    console.log(`클라이언트 연결됨: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    console.log(`클라이언트 연결 해제됨: ${client.id}`);
  }

  // 방 참가 이벤트
  @SubscribeMessage('joinRoom')
  async handleJoinRoom(
    @MessageBody() data: { roomId: string; player: Player },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      await this.gameService.addPlayerToRoom(data.roomId, data.player);
      // 플레이어의 고유 식별을 위해, 플레이어의 userId(문자열) 방에도 가입
      client.join(data.roomId);
      client.join(data.player.userId.toString());
      client.emit('joinedRoom', { success: true, roomId: data.roomId });
    } catch (error) {
      client.emit('error', { message: error.message });
    }
  }

  // 게임 시작 이벤트
  @SubscribeMessage('startGame')
  async handleStartGame(
    @MessageBody() data: { roomId: string },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      // startGame 메서드가 할당된 플레이어 배열을 반환하도록 수정
      const players = await this.gameService.startGame(data.roomId);
      // 각 플레이어의 고유 소켓(플레이어의 userId를 문자열로)으로 개별 역할 정보 전송
      players.forEach((player) => {
        this.server
          .to(player.userId.toString())
          .emit('yourRole', { role: player.role });
      });
      // 전체 방에는 게임 시작 이벤트 전송
      client.to(data.roomId).emit('gameStarted', { roomId: data.roomId });
    } catch (error) {
      client.emit('error', { message: error.message });
    }
  }

  // 플레이어 준비 이벤트
  @SubscribeMessage('playerReady')
  async handlePlayerReady(
    @MessageBody() data: { roomId: string; userId: number },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      await this.gameService.setPlayerReady(data.roomId, data.userId);
      client.emit('playerReadyAck', { userId: data.userId });
    } catch (error) {
      client.emit('error', { message: error.message });
    }
  }

  // 야간 행동 제출 이벤트 (마피아, 의사, 경찰)
  @SubscribeMessage('submitNightActions')
  async handleNightActions(
    @MessageBody()
    data: {
      roomId: string;
      actions: {
        mafiaActions?: { [userId: number]: number };
        doctorAction?: number;
        policeAction?: number;
      };
    },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      const result = await this.gameService.processNightActions(
        data.roomId,
        data.actions,
      );
      client.to(data.roomId).emit('nightResult', result);
    } catch (error) {
      client.emit('error', { message: error.message });
    }
  }

  // 낮 투표 이벤트
  @SubscribeMessage('vote')
  async handleVote(
    @MessageBody() data: { roomId: string; voterId: number; targetId: number },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      await this.gameService.recordVote(
        data.roomId,
        data.voterId,
        data.targetId,
      );
      client.to(data.roomId).emit('voteUpdated', data);
    } catch (error) {
      client.emit('error', { message: error.message });
    }
  }
}
