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
    await this.gameService.startNightPhase(data.roomId); // 데이터베이스 업데이트
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

      //  gameId 조회 추가 (오류 수정)
      const gameId = await this.gameService.getCurrentGameId(data.roomId);
      if (!gameId) {
        throw new BadRequestException(
          '현재 진행 중인 게임이 존재하지 않습니다.',
        );
      }

      //  사형이 결정되면 저장된 targetId를 조회하여 해당 플레이어를 사망 처리
      const targetId = await this.gameService.getTargetId(data.roomId);
      if (targetId !== null && finalResult.execute) {
        console.log(`사형 결정 - 플레이어 ${targetId}를 제거합니다.`);

        //  플레이어 사망 처리
        await this.gameService.killPlayers(data.roomId, [targetId]);

        //  사망자 확인을 위해 gameId 추가하여 getDead 호출 (오류 수정)
        const deadPlayers = await this.gameService.getDead(data.roomId, gameId);
        console.log(`현재 사망자 목록:`, deadPlayers);

        this.roomService.sendSystemMessage(
          this.server,
          data.roomId,
          `플레이어 ${targetId}가 사망 처리되었습니다.`,
        );

        // this.server.to(data.roomId).emit('VOTE:SECOND:DEAD', {
        //   targetId,
        // });
        // console.log('VOTE:SECOND:DEAD: 클라이언트로 수신됨');
        this.server.to(data.roomId).emit('NIGHT:START:SIGNAL');
        console.log('NIGHT:START:SIGNAL 이벤트 클라이언트로 수신됨');
      }

      //  게임 종료 체크
      const endCheck = await this.gameService.checkEndGame(data.roomId);
      if (endCheck.isGameOver) {
        const gameEndResult = await this.gameService.endGame(data.roomId);
        this.server.to(data.roomId).emit('gameEnd', gameEndResult);
        return;
      }

      // ✅ **밤 단계 시작 - `startNightPhase` 호출**
      console.log(`🌙 NIGHT:START 이벤트 실행 - 방 ${data.roomId}`);
      const nightResult = await this.gameService.startNightPhase(data.roomId);

      this.server.to(data.roomId).emit('ROOM:NIGHT_START', {
        roomId: data.roomId,
        nightNumber: nightResult.nightNumber,
        message: '밤이 시작되었습니다. 마피아, 경찰, 의사는 행동을 수행하세요.',
      });

      console.log('게임이 계속 진행됩니다. 밤 페이즈로 이동합니다.');
    } catch (error: any) {
      console.error('VOTE:SECOND 처리 중 오류:', error);
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
  // ✅ 1. 밤 시작 이벤트 처리 (중복 실행 방지)
  @SubscribeMessage('NIGHT:START')
  async handleNightStart(
    @MessageBody() data: { roomId: string },
    @ConnectedSocket() client: Socket,
  ) {
    console.log('🌙 NIGHT:START 이벤트 수신됨', data.roomId);
    try {
      const gameId = await this.gameService.getCurrentGameId(data.roomId);
      if (!gameId) {
        throw new BadRequestException(
          '현재 진행 중인 게임이 존재하지 않습니다.',
        );
      }

      // ✅ 중복 실행 방지 (이미 밤이면 실행 안 함)
      const currentPhase = await this.gameService.getGamePhase(data.roomId);
      if (currentPhase === 'night') {
        console.warn(`⚠️ 이미 방 ${data.roomId}는 NIGHT 상태입니다.`);
        return;
      }

      const nightPhase = await this.gameService.startNightPhase(data.roomId);

      // 모든 플레이어에게 밤 시작 이벤트 전달
      this.server.to(data.roomId).emit('ROOM:NIGHT_START', {
        roomId: data.roomId,
        nightNumber: nightPhase.nightNumber,
        message: '밤이 시작되었습니다. 마피아, 경찰, 의사는 행동을 수행하세요.',
      });

      console.log(
        `🌌 Room ${data.roomId} - Night ${nightPhase.nightNumber} 시작됨`,
      );
    } catch (error) {
      console.error('🚨 NIGHT:START 처리 중 오류 발생', error);
      client.emit('error', { message: '밤 시작 처리 중 오류 발생.' });
    }
  }

  // ✅ 마피아 타겟 선택
  @SubscribeMessage('ACTION:MAFIA_TARGET')
  async handleMafiaTarget(
    @MessageBody()
    data: { roomId: string; userId: number; targetUserId: number },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      await this.gameService.selectMafiaTarget(
        data.roomId,
        data.userId,
        data.targetUserId,
      );
      await this.gameService.setNightActionComplete(data.roomId, 'mafia');

      console.log(`🔥 [마피아] 대상 선택 완료: ${data.targetUserId}`);

      this.server.to(data.roomId).emit('ACTION:MAFIA_TARGET', {
        message: '마피아 대상 선택 완료',
      });

      // ✅ 밤 행동 완료 체크 후 처리
      const allCompleted = await this.gameService.checkAllNightActionsCompleted(
        data.roomId,
      );
      if (allCompleted) {
        await this.gameService.triggerNightProcessing(data.roomId);
      }
    } catch (error) {
      console.error('🚨 마피아 공격 오류:', error);
      client.emit('error', { message: '마피아 공격 처리 중 오류 발생.' });
    }
  }

  // ✅ 경찰 조사
  @SubscribeMessage('ACTION:POLICE_TARGET')
  async handlePoliceTarget(
    @MessageBody()
    data: { roomId: string; userId: number; targetUserId: number },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      await this.gameService.savePoliceTarget(data.roomId, data.targetUserId);
      await this.gameService.setNightActionComplete(data.roomId, 'police');

      console.log(`🔍 [경찰] 조사 대상 선택 완료: ${data.targetUserId}`);

      this.server
        .to(data.roomId)
        .emit('ACTION:POLICE_TARGET', { message: '경찰 조사 완료' });

      // ✅ 밤 행동 완료 체크 후 처리
      const allCompleted = await this.gameService.checkAllNightActionsCompleted(
        data.roomId,
      );
      if (allCompleted) {
        await this.gameService.triggerNightProcessing(data.roomId);
      }
    } catch (error) {
      console.error('🚨 경찰 조사 오류:', error);
      client.emit('error', { message: '경찰 조사 처리 중 오류 발생.' });
    }
  }

  // ✅ 의사 보호
  @SubscribeMessage('ACTION:DOCTOR_TARGET')
  async handleDoctorTarget(
    @MessageBody()
    data: { roomId: string; userId: number; targetUserId: number },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      await this.gameService.saveDoctorTarget(data.roomId, data.targetUserId);
      await this.gameService.setNightActionComplete(data.roomId, 'doctor');

      console.log(`💊 [의사] 보호 대상 선택 완료: ${data.targetUserId}`);

      this.server
        .to(data.roomId)
        .emit('ACTION:DOCTOR_TARGET', { message: '의사 보호 완료' });

      // ✅ 밤 행동 완료 체크 후 처리
      const allCompleted = await this.gameService.checkAllNightActionsCompleted(
        data.roomId,
      );
      if (allCompleted) {
        await this.gameService.triggerNightProcessing(data.roomId);
      }
    } catch (error) {
      console.error('🚨 의사 보호 오류:', error);
      client.emit('error', { message: '의사 보호 처리 중 오류 발생.' });
    }
  }
  //  경찰 조사 결과 전송
  @SubscribeMessage('REQUEST:POLICE_RESULT')
  async handlePoliceResult(
    @MessageBody() data: { roomId: string },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      const gameId = await this.gameService.getCurrentGameId(data.roomId);
      if (!gameId) {
        throw new BadRequestException(
          '현재 진행 중인 게임이 존재하지 않습니다.',
        );
      }

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

  // ✅  밤 결과 처리 후 발표 (이건 유지해야 함)
  @SubscribeMessage('PROCESS:NIGHT_RESULT')
  async handleNightResult(
    @MessageBody() data: { roomId: string },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      console.log(`🌙 Room ${data.roomId} - NIGHT RESULT PROCESSING`);

      const gameId = await this.gameService.getCurrentGameId(data.roomId);
      if (!gameId) {
        console.error('🚨 NIGHT RESULT ERROR: gameId가 존재하지 않음.');
        client.emit('error', {
          message: '현재 진행 중인 게임이 존재하지 않습니다.',
        });
        return;
      }

      // 밤 결과 처리
      const result = await this.gameService.processNightResult(data.roomId);
      console.log(`🛑 밤 결과:`, result);

      // 게임 종료 체크
      const endCheck = await this.gameService.checkEndGame(data.roomId);
      if (endCheck.isGameOver) {
        console.log(`🏁 게임 종료 감지 - ${endCheck.winningTeam} 팀 승리!`);
        const endResult = await this.gameService.endGame(data.roomId);
        this.server.to(data.roomId).emit('gameEnd', endResult);
        return;
      }

      // 밤 결과 브로드캐스트
      this.server.to(data.roomId).emit('ROOM:NIGHT_RESULT', {
        roomId: data.roomId,
        result,
        message: `🌙 밤 결과: ${result.details}`,
      });

      // ✅ 낮 단계로 전환 (10초 후) (gameId가 null인지 다시 한 번 체크)
      console.log(`낮 단계로 전환 준비중...`);
      setTimeout(async () => {
        const newGameId = await this.gameService.getCurrentGameId(data.roomId);
        if (!newGameId) {
          console.error('🚨 낮 단계 전환 실패: gameId가 null임.');
          return;
        }

        const newDay = await this.gameService.startDayPhase(
          data.roomId,
          newGameId,
        );
        this.server.to(data.roomId).emit('message', {
          sender: 'system',
          message: `Day ${newDay} 낮이 밝았습니다!`,
        });
        console.log(`✅ [DAY] Day ${newDay} 낮 단계로 이동`);
      }, 10000);
    } catch (error) {
      console.error(`🚨 NIGHT RESULT ERROR:`, error.message, error.stack);
      client.emit('error', { message: '밤 결과 처리 중 오류 발생.' });
    }
  }
}
