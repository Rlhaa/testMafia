// src/rooms/room.gateway.ts
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({
  namespace: 'room', // 클라이언트는 ws://localhost:3000/room에 연결
})
export class RoomGateway {
  @WebSocketServer()
  server: Server;

  // 간단한 in-memory 매핑: userId -> socketId (테스트용)
  private userSocketMap: Map<number, string> = new Map();

  @SubscribeMessage('joinRoom')
  handleJoinRoom(
    @MessageBody() data: { roomId: string; userId: number },
    @ConnectedSocket() client: Socket,
  ) {
    const { roomId, userId } = data;
    if (!roomId || !userId) {
      client.emit('error', { message: 'roomId와 userId가 필요합니다.' });
      return;
    }
    client.join(roomId);
    this.userSocketMap.set(userId, client.id);
    this.server.to(roomId).emit('message', {
      sender: 'system',
      message: `User ${userId} has joined room ${roomId}.`,
    });
  }

  @SubscribeMessage('chatMessage')
  handleChatMessage(
    @MessageBody() data: { roomId: string; userId: number; message: string },
    @ConnectedSocket() client: Socket,
  ) {
    const { roomId, userId, message } = data;
    if (!roomId || !userId || !message) {
      client.emit('error', {
        message: 'roomId, userId, message가 필요합니다.',
      });
      return;
    }
    this.server.to(roomId).emit('message', {
      sender: userId,
      message,
    });
  }

  @SubscribeMessage('leaveRoom')
  handleLeaveRoom(
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
  }
}
