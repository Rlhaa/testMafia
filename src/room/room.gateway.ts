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
import { NightResultService } from 'src/notice/night-result.service';
import { Inject, forwardRef } from '@nestjs/common';

export interface Player {
  id: number;
  role?: string;
  isAlive: boolean;
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
    @Inject(forwardRef(() => RoomService))
    private readonly roomService: RoomService,
    @Inject(forwardRef(() => NightResultService))
    private readonly nightResultService: NightResultService,
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

  @SubscribeMessage('chatDead')
  async handleChatDead(
    @MessageBody() data: { roomId: string; userId: number; message: string },
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
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

      // 죽은 플레이어들만 필터링합니다.
      const deadPlayers = await this.gameService.getDead(
        data.roomId,
        currentGId,
      );
      let messageSentToDeadPlayers = false;

      deadPlayers.forEach((deadPlayer) => {
        const deadPlayerSocketId = this.roomService.getUserSocketMap(
          deadPlayer.id,
        );
        if (deadPlayerSocketId) {
          this.server.to(deadPlayerSocketId).emit('message', {
            sender: data.userId,
            message: data.message,
          });
          messageSentToDeadPlayers = true;
        }
      });
    } catch (error) {
      console.error('handleChatDead Error:', error);
      client.emit('error', {
        message: '죽은 플레이어 메시지 처리 중 오류 발생.',
      });
    }
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
      // 각 마피아에게 메시지를 전송
      mafias.forEach((mafia) => {
        const mafiaPlayerSocketId = this.roomService.getUserSocketMap(mafia.id);
        if (gameData.phase === 'night' && mafiaPlayerSocketId) {
          this.server.to(mafiaPlayerSocketId).emit('message', {
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

  @SubscribeMessage('VOTE:FIRST')
  async handleFirstVote(
    @MessageBody() data: { roomId: string; voterId: number; targetId: number },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      const result = await this.gameService.handleFirstVoteProcess(
        data.roomId,
        data.voterId,
        data.targetId,
      );
      console.log('handleFirstVote 결과:', result);

      if (!result.success) {
        // 실패한 경우는 여기서 끝냄
        return;
      }

      // 투표 정보 업데이트를 전송
      this.server.to(data.roomId).emit('UPDATE_VOTES', result.voteData);
      console.log('투표 업데이트 전송 - roomId:', data.roomId);

      // 아직 모든 플레이어가 투표하지 않았다면 함수 종료
      if (!result.allVotesCompleted) return;

      console.log('모든 플레이어가 투표 완료됨 - roomId:', data.roomId);
      this.server.to(data.roomId).emit('VOTE:COMPLETE', {
        message: '모든 플레이어가 투표를 완료했습니다.',
      });

      const finalResult = await this.gameService.calculateVoteResult(
        data.roomId,
      );
      console.log('투표 결과 계산 완료:', finalResult);

      // 동점인 경우 처리
      if (finalResult.tie) {
        this.roomService.sendSystemMessage(
          this.server,
          data.roomId,
          `투표 결과: 동률이 발생하여 밤이 시작됩니다. (${finalResult.tieCandidates.join(
            ', ',
          )} ${finalResult.voteCount}표)`,
        );
        this.server.to(data.roomId).emit('NIGHT:PHASE', {
          message: '동점으로 인해 밤 단계로 넘어갑니다.',
        });
        return;
      }

      // 동점이 아니라면 VOTE:SURVIVAL 이벤트 전송 및 시스템 메시지 전달
      console.log(
        `VOTE:SURVIVAL 이벤트 전송 - roomId: ${data.roomId}, result:`,
        finalResult,
      );
      this.server.to(data.roomId).emit('VOTE:SURVIVAL', {
        message: `투표 결과: 최다 득표자 ${finalResult.winnerId} (${finalResult.voteCount}표). 생존 투표를 진행합니다.`,
        winnerId: finalResult.winnerId,
        voteCount: finalResult.voteCount,
      });
      this.roomService.sendSystemMessage(
        this.server,
        data.roomId,
        `투표 결과: 최다 득표자 ${finalResult.winnerId} (${finalResult.voteCount}표).`,
      );
    } catch (error) {
      console.error('handleFirstVote 에러 발생:', error);
      client.emit('voteError', '투표 처리 중 오류 발생.');
    }
  }

  @SubscribeMessage('VOTE:SECOND')
  async handleSurvivalVote(
    @MessageBody() data: { roomId: string; voterId: number; execute: boolean },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      console.log(`VOTE:SURVIVAL 게이트웨이에서 수신!`);
      // 예: 게임 서비스의 생존/사살 투표 처리 메서드 호출
      // const result = await this.gameService.handleSurvivalVoteProcess(data.roomId, data.voterId, data.execute);

      // 처리 후 필요한 이벤트(예: UPDATE_SURVIVAL_VOTES, VOTE:SURVIVAL:RESULT 등)를 발행
      // this.server.to(data.roomId).emit('UPDATE_SURVIVAL_VOTES', result.voteData);
      // if(result.allVotesCompleted) {
      //   const finalResult = await this.gameService.calculateSurvivalVoteResult(data.roomId);
      //   this.server.to(data.roomId).emit('VOTE:SURVIVAL:RESULT', finalResult);
      // }

      // 여기서는 단순히 성공 응답만 전송
      client.emit('VOTE:SURVIVAL:RESPONSE', {
        success: true,
        message: '생존 투표 처리 완료.',
      });
    } catch (error: any) {
      client.emit('voteError', { message: error.message });
    }
  }
  /**
   * 클라이언트에게 메시지를 브로드캐스트하는 유틸리티 함수
   * (서비스에서 호출하여 공지를 전파할 때 사용)
   */
  broadcastNotice(
    roomId: string,
    event: string,
    message: string,
    additionalData?: Record<string, any>,
  ) {
    const payload = { roomId, message, ...additionalData };
    this.server.to(roomId).emit(event, payload);
  }
}
