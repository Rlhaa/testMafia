/* eslint-disable @typescript-eslint/no-unsafe-assignment */
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
import { TimerService } from 'src/timer/timer.service';
import { error } from 'console';

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
    private readonly timerService: TimerService,
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

  //방 아이디로 게임 아이디 받아오기
  async getCurrentGameId(roomId: string) {
    const currentGameId = await this.gameService.getCurrentGameId(roomId);
    if (!currentGameId) {
      throw new BadRequestException('게임 ID를 찾을 수 없습니다.');
    }
    return currentGameId;
  }

  //게임 아이디와 방 아이디로 게임 데이터 받아오기
  async getGameData(roomId: string, gameId: string) {
    return await this.gameService.getGameData(roomId, gameId);
  }

  //발신인 정보 받아오기
  async getSpeakerInfo(roomId: string, userId: number) {
    // 방의 플레이어 정보를 가져옵니다.
    const gameId = await this.getCurrentGameId(roomId);
    const gameData = await this.getGameData(roomId, gameId);
    const players: Player[] = gameData.players;

    // 메시지를 보낸 사용자의 정보를 찾습니다.
    const sender = players.find((player) => player.id === userId);
    if (!sender) {
      throw new BadRequestException('발신자를 찾을 수 없습니다.');
    }
    return sender;
  }

  @SubscribeMessage('chatDead')
  async handleChatDead(
    @MessageBody() data: { roomId: string; userId: number; message: string },
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    try {
      // 방의 플레이어 정보를 가져옵니다.
      const currentGId = await this.getCurrentGameId(data.roomId);

      // 메시지를 보낸 사용자의 정보를 찾습니다.
      const sender = await this.getSpeakerInfo(data.roomId, data.userId);

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
            sender: sender.id,
            message: data.message,
          });
          messageSentToDeadPlayers = true;
        }
        // 죽은 사람들에게 메시지를 보냈다면 방의 모든 클라이언트에게는 보내지 않음
        //이 경우 6명이 죽은 상황이면 이 짓을 6번 반복하기 때문에 비효율적
        //같은 게임 내에서 죽은 자들만 소통 가능한 채팅방과 마피아끼리만 대화 가능한 방을 별도로 파서 운영하는 건?
        if (!messageSentToDeadPlayers) {
          this.server.to(data.roomId).emit('message', {
            sender: sender.id,
            message: data.message,
          });
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
      const currentGId = await this.getCurrentGameId(data.roomId);
      const gameData = await this.getGameData(data.roomId, currentGId);

      // 메시지를 보낸 사용자의 정보를 찾습니다.
      const sender = await this.getSpeakerInfo(data.roomId, data.userId);

      // 마피아인 플레이어만 필터링합니다.
      const mafias = await this.gameService.getMafias(data.roomId, currentGId);
      let messageSentToMafias = false;

      // 마피아 플레이어에게만 메시지를 브로드캐스트합니다.
      // 각 마피아에게 메시지를 전송
      mafias.forEach((mafia) => {
        const mafiaPlayerSocketId = this.roomService.getUserSocketMap(mafia.id);
        if (gameData.phase === 'night' && mafiaPlayerSocketId) {
          this.server.to(mafiaPlayerSocketId).emit('message', {
            sender: sender.id,
            message: data.message,
          });
          messageSentToMafias = true; // 마피아에게 메시지를 보냈음을 기록
        }
      });
      // 마피아에게 메시지를 보냈다면 방의 모든 클라이언트에게는 보내지 않음
      if (!messageSentToMafias) {
        this.server.to(data.roomId).emit('message', {
          sender: sender.id,
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

    await this.gameService.startNightPhase(data.roomId); // 데이터베이스 업데이트
    this.server.to(data.roomId).emit('PHASE_UPDATED', { phase: data.phase });
  }

  //사망 처리 이벤트
  @SubscribeMessage('KILL_PLAYERS')
  async handleKillPlayers(
    @MessageBody() data: { roomId: string; players: number[] },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      await this.gameService.killPlayers(data.roomId, data.players);
      //const me=await this.getSpeakerInfo(data.roomId, data.players[0])
      this.server.to(data.roomId).emit('PLAYERS_KILLED', {
        message: `플레이어 ${data.players.join(', ')}가 사망 처리되었습니다.`,
        isAlive: false,
      });
    } catch (error) {
      console.error('handleKillPlayers 에러 발생:', error);
      client.emit('error', { message: '사망 처리 중 오류 발생.' });
    }
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
      if (result.allVotesCompleted) {
        this.timerService.cancelTimer(data.roomId, 'day');
        await this.finalizeFirstVote(data.roomId);
      }
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
      if (result.allVotesCompleted) {
        this.timerService.cancelTimer(data.roomId, 'secondVoteTimer');
        await this.finalizeSecondVote(data.roomId);
      }
    } catch (error) {
      console.error('handleSecondVote 에러 발생:', error);
      client.emit('voteError', '투표 처리 중 오류 발생.');
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
  //CHAN 임시 로직 수정
  async announceFirstVoteStart(
    roomId: string,
    dayNumber: number,
  ): Promise<void> {
    this.nightResultService.announceFirstVoteStart(roomId, dayNumber);

    // 15초 후 자동으로 투표 마감
    this.timerService
      .startTimer(roomId, 'firstVoteTimer', 15000)
      .subscribe(async () => {
        console.log('1차 투표 시간이 만료되었습니다. 결과를 계산합니다.');
        await this.finalizeFirstVote(roomId);
      });
  }

  private async finalizeFirstVote(roomId: string) {
    try {
      //CHAN 데이 얻을 방법 이것밖에 없나?
      const gameId = await this.gameService.getCurrentGameId(roomId);
      const gameData = await this.gameService.getGameData(
        roomId,
        String(gameId),
      );
      let currentDay = parseInt(gameData.day, 10) || 0;
      const finalResult =
        await this.gameService.calculateFirstVoteResult(roomId);
      console.log('투표 결과 계산 완료:', finalResult);

      if (finalResult.tie) {
        this.roomService.sendSystemMessage(
          this.server,
          roomId,
          `투표 결과: 동률 발생 (${finalResult.tieCandidates.join(', ')} ${finalResult.voteCount}표) → 밤 단계로 전환.`,
        );
        this.gameService.startNightPhase(roomId);
        this.server.to(roomId).emit('NIGHT:PHASE', {
          message: '동점으로 인해 밤 단계로 넘어갑니다.',
        });
        return;
      }

      // 최다 득표자를 targetId로 저장
      await this.gameService.setTargetId(roomId, finalResult.winnerId!);
      this.server.to(roomId).emit('VOTE:SURVIVAL', {
        winnerId: finalResult.winnerId,
        voteCount: finalResult.voteCount,
      });
      this.roomService.sendSystemMessage(
        this.server,
        roomId,
        `투표 결과: 최다 득표자 ${finalResult.winnerId} (${finalResult.voteCount}표) → 생존 투표 진행.`,
      );
      this.announceSecondVoteStart(roomId, currentDay);
    } catch (error) {
      console.error('finalizeFirstVote 오류 발생:', error);
    }
  }

  async announceSecondVoteStart(
    roomId: string,
    dayNumber: number,
  ): Promise<void> {
    this.nightResultService.announceSecondVoteStart(roomId, dayNumber);

    // 45초 후 자동으로 투표 마감
    this.timerService
      .startTimer(roomId, 'secondVoteTimer', 45000)
      .subscribe(async () => {
        console.log('2차 투표 시간이 만료되었습니다. 결과를 계산합니다.');
        await this.finalizeSecondVote(roomId);
      });
  }

  private async finalizeSecondVote(roomId: string) {
    try {
      const finalResult =
        await this.gameService.calculateSecondVoteResult(roomId);
      console.log('투표 결과 계산 완료:', finalResult);

      if (finalResult.tie) {
        this.roomService.sendSystemMessage(
          this.server,
          roomId,
          `투표 결과: 동률 발생. 사형 투표자: ${finalResult.executeVoterIds}, 생존 투표자: ${finalResult.surviveVoterIds}`,
        );
        this.gameService.startNightPhase(roomId);
        this.server.to(roomId).emit('NIGHT:PHASE', {
          message: '생존투표 동률, 밤 단계 시작',
        });
        return;
      }

      this.roomService.sendSystemMessage(
        this.server,
        roomId,
        `투표 결과: ${finalResult.execute ? '사형' : '생존'} - (${finalResult.voteCount}표), 사형 투표자: ${finalResult.executeVoterIds}, 생존 투표자: ${finalResult.surviveVoterIds}`,
      );

      //  gameId 조회 추가 (오류 수정)
      const gameId = await this.gameService.getCurrentGameId(roomId);
      if (!gameId) {
        throw new BadRequestException(
          '현재 진행 중인 게임이 존재하지 않습니다.',
        );
      }

      //  사형이 결정되면 저장된 targetId를 조회하여 해당 플레이어를 사망 처리
      const targetId = await this.gameService.getTargetId(roomId);
      if (targetId !== null && finalResult.execute) {
        console.log(`사형 결정 - 플레이어 ${targetId}를 제거합니다.`);

        //  플레이어 사망 처리
        await this.gameService.killPlayers(roomId, [targetId]);

        //  사망자 확인을 위해 gameId 추가하여 getDead 호출 (오류 수정)
        const deadPlayers = await this.gameService.getDead(roomId, gameId);
        console.log(`현재 사망자 목록:`, deadPlayers);

        this.roomService.sendSystemMessage(
          this.server,
          roomId,
          `플레이어 ${targetId}가 사망 처리되었습니다.`,
        );
        // 이부분 받는게 있나??
        this.server.to(roomId).emit('VOTE:SECOND:DEAD', {
          targetId,
        });
      }

      //  게임 종료 체크
      const endCheck = await this.gameService.checkEndGame(roomId);
      if (endCheck.isGameOver) {
        const gameEndResult = await this.gameService.endGame(roomId);
        this.server.to(roomId).emit('gameEnd', gameEndResult);
        return;
      }

      //  밤 페이즈로 이동
      this.server.to(roomId).emit('NIGHT:PHASE', {
        message: '밤이 찾아옵니다.',
      });

      console.log('게임이 계속 진행됩니다. 밤 페이즈로 이동합니다.');
    } catch (error) {
      console.error('finalizeFirstVote 오류 발생:', error);
    }
  }

  @SubscribeMessage('endGame')
  async handleEndGame(
    @MessageBody() data: { roomId: string },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      const result = await this.gameService.endGame(data.roomId);
      this.server.to(data.roomId).emit('gameEnd', result);
    } catch (error) {
      client.emit('error', { message: '게임 종료 처리 중 오류 발생.' });
    }
  }

  // 1. 밤 시작 이벤트 처리
  @SubscribeMessage('START:NIGHT')
  async handleNightStart(
    @MessageBody() data: { roomId: string },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      const nightNumber = await this.gameService.startNightPhase(data.roomId);
      this.server.to(data.roomId).emit('ROOM:NIGHT_START', {
        roomId: data.roomId,
        nightNumber,
        message: '밤이 시작되었습니다. 마피아, 경찰, 의사는 행동을 수행하세요.',
      });
    } catch (error) {
      client.emit('error', { message: '밤 시작 처리 중 오류 발생.' });
    }
  }

  // 2. 마피아 공격 이벤트 처리
  @SubscribeMessage('ACTION:MAFIA_TARGET')
  async handleMafiaTarget(
    @MessageBody()
    data: {
      roomId: string;
      userId: number | string;
      targetUserId: number | string;
    },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      const userId = Number(data.userId);
      const targetUserId = Number(data.targetUserId);

      await this.gameService.selectMafiaTarget(
        data.roomId,
        userId,
        targetUserId,
      );
      client.emit('ACTION:MAFIA_TARGET', { message: '마피아 대상 선택 완료' });
    } catch (error) {
      client.emit('error', { message: '마피아 공격 처리 중 오류 발생.' });
    }
  }

  // 3. 의사 보호 이벤트 처리 (결과는 의사에게만 전송)
  @SubscribeMessage('ACTION:DOCTOR_TARGET')
  async handleDoctorTarget(
    @MessageBody()
    data: {
      roomId: string;
      userId?: number | string;
      targetUserId?: number | string;
    },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      if (!data.userId || !data.targetUserId) {
        client.emit('error', {
          message: '의사 보호 대상이 올바르게 제공되지 않았습니다.',
        });
        return;
      }

      const userId = Number(data.userId);
      const targetUserId = Number(data.targetUserId);

      if (isNaN(userId) || isNaN(targetUserId)) {
        client.emit('error', {
          message: '의사 보호 대상 ID가 올바르지 않습니다.',
        });
        return;
      }

      await this.gameService.saveDoctorTarget(data.roomId, targetUserId);
      client.emit('ACTION:DOCTOR_TARGET', { message: '보호 대상 선택 완료' });
    } catch (error) {
      client.emit('error', { message: '의사 보호 처리 중 오류 발생.' });
    }
  }

  // 4. 경찰 조사 이벤트 처리 (결과는 경찰에게만 전송)
  @SubscribeMessage('ACTION:POLICE_TARGET')
  async handlePoliceTarget(
    @MessageBody()
    data: {
      roomId: string;
      userId?: number | string;
      targetUserId?: number | string;
    },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      if (!data.userId || !data.targetUserId) {
        client.emit('error', {
          message: '경찰 조사 대상이 올바르게 제공되지 않았습니다.',
        });
        return;
      }

      const userId = Number(data.userId);
      const targetUserId = Number(data.targetUserId);

      if (isNaN(userId) || isNaN(targetUserId)) {
        client.emit('error', {
          message: '경찰 조사 대상 ID가 올바르지 않습니다.',
        });
        return;
      }

      await this.gameService.savePoliceTarget(data.roomId, targetUserId);
      client.emit('ACTION:POLICE_TARGET', { message: '조사 대상 선택 완료' });
    } catch (error) {
      client.emit('error', { message: '경찰 조사 처리 중 오류 발생.' });
    }
  }

  // 5. 경찰 조사 결과 전송 (경찰에게만 전달)
  @SubscribeMessage('REQUEST:POLICE_RESULT')
  async handlePoliceResult(
    @MessageBody() data: { roomId: string },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      const result = await this.gameService.getPoliceResult(data.roomId);
      if (!result.policeId) {
        client.emit('error', { message: '경찰이 존재하지 않습니다.' });
        return;
      }
      if (!result.targetUserId) {
        client.emit('error', { message: '조사 대상이 선택되지 않았습니다.' });
        return;
      }

      client.emit('POLICE:RESULT', {
        roomId: data.roomId,
        targetUserId: result.targetUserId,
        role: result.role,
      });
    } catch (error) {
      client.emit('error', { message: '경찰 조사 결과 전송 중 오류 발생.' });
    }
  }

  // 6. 밤 결과 처리 후 발표 (모든 플레이어에게 알림)
  @SubscribeMessage('PROCESS:NIGHT_RESULT')
  async handleNightResult(
    @MessageBody() data: { roomId: string },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      const result = await this.gameService.processNightResult(data.roomId);

      const endCheck = await this.gameService.checkEndGame(data.roomId);
      if (endCheck.isGameOver) {
        const endResult = await this.gameService.endGame(data.roomId);
        this.server.to(data.roomId).emit('gameEnd', endResult);
        return;
      }

      this.server.to(data.roomId).emit('ROOM:NIGHT_RESULT', {
        roomId: data.roomId,
        result,
        message: `밤 결과: ${result.details}`,
      });
    } catch (error) {
      client.emit('error', { message: '밤 결과 처리 중 오류 발생.' });
    }
  }
}
