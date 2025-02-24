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
import { BadRequestException } from '@nestjs/common';
import { NightResultService } from 'src/notice/night-result.service';
import { Inject, forwardRef } from '@nestjs/common';

export interface Player {
  id: number;
  role?: string;
  isAlive: boolean;
}

@WebSocketGateway({
  namespace: 'room',
})
export class RoomGateway implements OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  constructor(
    @Inject(forwardRef(() => GameService))
    private readonly gameService: GameService,
    @Inject(forwardRef(() => RoomService))
    private readonly roomService: RoomService,
    @Inject(forwardRef(() => NightResultService))
    private readonly nightResultService: NightResultService,
  ) {}

  // ──────────────────────────────
  // 기본 이벤트 핸들러 (채팅, 입장, 퇴장, 연결 종료)
  // ──────────────────────────────

  @SubscribeMessage('chatMessage')
  handleChatMessage(
    @MessageBody() data: { roomId: string; userId: number; message: string },
    @ConnectedSocket() client: Socket,
  ) {
    // 채팅 메시지를 해당 룸의 모든 클라이언트에게 브로드캐스트
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
          this.server.to(deadPlayerSocketId).emit('CHAT:DEAD', {
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
          this.server.to(mafiaPlayerSocketId).emit('CHAT:MAFIA', {
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

  async handleDisconnect(client: Socket) {
    const roomId = client.handshake.auth.roomId as string;
    const userId = client.handshake.auth.userId as number;
    await this.roomService.leaveRoom(this.server, client, roomId, userId);
  }

  // ──────────────────────────────
  // 투표 이벤트 핸들러 (1차 투표 / 2차 투표)
  // ──────────────────────────────

  // 1차 투표 처리: 투표 진행 → 결과 계산 → (동점이 아니라면) targetId 저장 후 생존 투표 진행 이벤트 전송
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
      if (!result.success) return;
      if (!result.allVotesCompleted) return;

      const finalResult = await this.gameService.calculateFirstVoteResult(
        data.roomId,
      );
      console.log('투표 결과 계산 완료:', finalResult);

      if (finalResult.tie) {
        this.roomService.sendSystemMessage(
          this.server,
          data.roomId,
          `투표 결과: 동률 발생 (${finalResult.tieCandidates.join(
            ', ',
          )} ${finalResult.voteCount}표) → 밤 단계로 전환.`,
        );
        this.server.to(data.roomId).emit('NIGHT:PHASE', {
          message: '동점으로 인해 밤 단계로 넘어갑니다.',
        });
        return;
      }

      // 동점이 아닌 경우, 최다 득표자를 targetId로 저장
      await this.gameService.setTargetId(data.roomId, finalResult.winnerId!);
      this.server.to(data.roomId).emit('VOTE:SURVIVAL', {
        winnerId: finalResult.winnerId,
        voteCount: finalResult.voteCount,
      });
      this.roomService.sendSystemMessage(
        this.server,
        data.roomId,
        `투표 결과: 최다 득표자 ${finalResult.winnerId} (${finalResult.voteCount}표) → 생존 투표 진행.`,
      );
    } catch (error) {
      console.error('handleFirstVote 에러 발생:', error);
      client.emit('voteError', '투표 처리 중 오류 발생.');
    }
  }

  // 2차 투표 처리: 투표 진행 → 결과 계산 → (사형 결정 시) targetId 조회 후 해당 플레이어 사망 처리
  @SubscribeMessage('VOTE:SECOND')
  async handleSecondVote(
    @MessageBody() data: { roomId: string; voterId: number; execute: boolean },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      console.log('VOTE:SECOND 수신:', data);
      const result = await this.gameService.handleSecondVoteProcess(
        data.roomId,
        data.voterId,
        data.execute,
      );
      console.log('handleSecondVote 결과:', result);
      if (!result.allVotesCompleted) return;

      const finalResult = await this.gameService.calculateSecondVoteResult(
        data.roomId,
      );
      console.log('투표 결과 계산 완료:', finalResult);

      if (finalResult.tie) {
        this.roomService.sendSystemMessage(
          this.server,
          data.roomId,
          `투표 결과: 동률 발생. 사형 투표자: ${finalResult.executeVoterIds}, 생존 투표자: ${finalResult.surviveVoterIds}`,
        );
        this.server.to(data.roomId).emit('NIGHT:PHASE', {
          message: '생존투표 동률, 밤 단계 시작',
        });
        return;
      }

      this.roomService.sendSystemMessage(
        this.server,
        data.roomId,
        `투표 결과: ${finalResult.execute ? '사형' : '생존'} - (${finalResult.voteCount}표), 사형 투표자: ${finalResult.executeVoterIds}, 생존 투표자: ${finalResult.surviveVoterIds}`,
      );

      // 사형이 결정되면 저장된 targetId를 조회하여 해당 플레이어를 사망 처리
      const targetId = await this.gameService.getTargetId(data.roomId);
      if (targetId !== null) {
        await this.gameService.killPlayers(data.roomId, [targetId]);
        this.roomService.sendSystemMessage(
          this.server,
          data.roomId,
          `플레이어 ${targetId}가 사망 처리되었습니다.`,
        );
        this.server.to(data.roomId).emit('VOTE:SECOND:END', {
          targetId,
        });
      }
      this.server.to(data.roomId).emit('NIGHT:BACKGROUND', {
        message: '생존투표 후 사망자 처리 완료, 밤 단계 시작',
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
