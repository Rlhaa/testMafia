import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  ConnectedSocket,
  MessageBody,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { GameService, FirstVote } from '../game/game.service';
import { RoomService } from './room.service';
import { BadRequestException } from '@nestjs/common';

export interface Player {
  id: number;
  role?: string;
  isAlive: boolean;
  socketId?: string; // 소켓 ID 추가
}

@WebSocketGateway({
  namespace: 'room', // 현재 단계에서 네임스페이스를 구성할 필요가 크진 않지만, 일단 이렇게 따로 웹소켓 통신 공간을 지정 가능
})
export class RoomGateway implements OnGatewayDisconnect {
  @WebSocketServer()
  // socket.io 서버 인스턴스 주입
  server: Server;

  constructor(
    private readonly gameService: GameService,
    private readonly roomService: RoomService,
  ) {}
  // @SubscribeMessage 데코레이터로 클라이언트에서 발행한 특정 이벤트를 구독할 수 있다.
  // >> 클라이언트가 chatMessage 이벤트를 발행하면, 이 데코레이터가 이벤트를 구독하여 내부 로직 실행
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

  //발신인 검증, 함수화 가능
  //나중에 생각하자
  // async getSpeakerInfo(@MessageBody() data: { roomId: string; userId: number; message: string },
  // @ConnectedSocket() client: Socket,) {
  //   // 방의 플레이어 정보를 가져옵니다.
  //   const currentGId = await this.gameService.getCurrentGameId(data.roomId);
  //   if (!currentGId) {
  //     throw new BadRequestException('게임 ID를 찾을 수 없습니다.');
  //   }
  //   const gameData = await this.gameService.getGameData(
  //     data.roomId,
  //     currentGId,
  //   );
  //   const players: Player[] = gameData.players
  //     ? JSON.parse(gameData.players)
  //     : [];

  //   // 메시지를 보낸 사용자의 정보를 찾습니다.
  //   const sender = players.find((player) => player.id === data.userId);

  //   if (!sender) {
  //     client.emit('error', { message: '사용자를 찾을 수 없습니다.' });
  //     return;
  //   }
  // }
  //
  //
  @SubscribeMessage('chatDead')
  async handleChatDead(
    @MessageBody() data: { roomId: string; userId: number; message: string },
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    // 방의 플레이어 정보를 가져옵니다.
    const currentGId = await this.gameService.getCurrentGameId(data.roomId);
    if (!currentGId) {
      throw new BadRequestException('게임 ID를 찾을 수 없습니다.');
    }
    const gameData = await this.gameService.getGameData(
      data.roomId,
      currentGId,
    );
    const players: Player[] = gameData.players;
    // ? JSON.parse(gameData.players)
    // : [];

    // 메시지를 보낸 사용자의 정보를 찾습니다.
    const sender = players.find((player) => player.id === data.userId);

    if (!sender) {
      client.emit('error', { message: '사용자를 찾을 수 없습니다.' });
      return;
    }

    // 죽은 플레이어만 필터링
    const deadPlayers = players.filter((player) => player.isAlive === false);

    // 죽은 플레이어에게만 메시지 전송
    deadPlayers.forEach((deadPlayer) => {
      this.server.to(deadPlayer.id.toString()).emit('CHAT:DEAD', {
        sender: data.userId,
        message: data.message,
      });
    });
  }

  @SubscribeMessage('chatMafia')
  async handleMafiaMessage(
    @MessageBody() data: { roomId: string; userId: number; message: string },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      // 방의 플레이어 정보를 가져옵니다.
      const currentGId = await this.gameService.getCurrentGameId(data.roomId);
      if (!currentGId) {
        throw new BadRequestException('게임 ID를 찾을 수 없습니다.');
      }

      const gameData = await this.gameService.getGameData(
        data.roomId,
        currentGId,
      );
      const players: Player[] = gameData.players;

      // 메시지를 보낸 사용자의 정보를 찾습니다.
      const sender = players.find((player) => player.id === data.userId);
      if (!sender) {
        client.emit('error', { message: '사용자를 찾을 수 없습니다.' });
        return;
      }

      // 마피아인 플레이어만 필터링합니다.
      const mafias = await this.gameService.getMafias(data.roomId, currentGId);
      let messageSentToMafias = false;

      // 마피아 플레이어에게만 메시지를 브로드캐스트합니다.
      mafias.forEach((mafia) => {
        const mafiaPlayer = players.find((player) => player.id === mafia.id);
        if (gameData.phase === 'night' && mafiaPlayer && mafiaPlayer.socketId) {
          this.server.to(mafiaPlayer.socketId).emit('CHAT:MAFIA', {
            sender: data.userId,
            message: data.message,
          });
          messageSentToMafias = true; // 마피아에게 메시지를 보냈음을 기록
        }
      });
      // 마피아에게 메시지를 보냈다면 방의 모든 클라이언트에게는 보내지 않음
      if (!messageSentToMafias) {
        this.server.to(data.roomId).emit('message', {
          sender: data.userId,
          message: data.message,
        });
      }
    } catch (error) {
      console.error('handleMafiaMessage Error:', error);
      client.emit('error', { message: '마피아 메시지 처리 중 오류 발생.' });
    }
  }

  //테스트용 임시로 페이즈 변경하는 버튼에 대응하는 게이트웨이
  @SubscribeMessage('SET_PHASE')
  async handleSetPhase(
    @MessageBody() data: { roomId: string; phase: string },
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    // 방의 플레이어 정보를 가져옵니다.
    const currentGId = await this.gameService.getCurrentGameId(data.roomId);
    if (!currentGId) {
      throw new BadRequestException('게임 ID를 찾을 수 없습니다.');
    }

    await this.gameService.startNightPhase(data.roomId, currentGId); // 데이터베이스 업데이트
    this.server.to(data.roomId).emit('PHASE_UPDATED', { phase: data.phase });
  }

  // joinRoom 이벤트: 룸 서비스의 joinRoom 메서드 호출
  // >> 추후 이벤트 네임 변경 할 수 있음(웹소켓 명세 따라)
  @SubscribeMessage('joinRoom')
  async handleJoinRoom(
    @MessageBody() data: { roomId: string; userId: number },
    @ConnectedSocket() client: Socket,
  ) {
    const { roomId, userId } = data;
    await this.roomService.joinRoom(
      this.server,
      client,
      roomId,
      userId,
      client.id,
    );
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

  @SubscribeMessage('VOTE:PLAYER')
  async handleFirstVote(
    @MessageBody() data: { roomId: string; voterId: number; targetId: number },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      // GameService의 메서드 호출하여 처리
      const result = await this.gameService.handleFirstVoteProcess(
        data.roomId,
        data.voterId,
        data.targetId,
      );

      if (result.success) {
        // 모든 클라이언트에게 실시간 투표 현황 업데이트
        this.server.to(data.roomId).emit('UPDATE_VOTES', result.voteData);

        // 모든 투표가 완료된 경우, 최종 투표 결과를 전송
        if (result.allVotesCompleted) {
          this.server.to(data.roomId).emit('VOTE:RESULT', result.finalResult);
        }
      } else {
        client.emit('voteError', '이미 투표한 상태입니다.');
      }
    } catch (error) {
      console.error('handleFirstVote Error:', error);
      client.emit('voteError', '투표 처리 중 오류 발생.');
    }
  }
}
