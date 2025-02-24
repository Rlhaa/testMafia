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
  namespace: 'room',
})
export class RoomGateway implements OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  constructor(
    private readonly gameService: GameService,
    private readonly roomService: RoomService,
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
        this.roomService.sendSystemMessage(
          this.server,
          data.roomId,
          `밤이 찾아옵니다..`,
        );
        this.server.to(data.roomId).emit('VOTE:SECOND:DEAD', {
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
}
