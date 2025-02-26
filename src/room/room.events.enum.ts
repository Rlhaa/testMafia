/**
 * RoomEvents
 *
 * 마피아 게임에서 사용되는 다양한 웹소켓 이벤트를 정의합니다.
 * 이 enum을 사용하면 이벤트 이름을 통일해서 관리할 수 있고,
 * JSDoc 주석을 통해 각 이벤트의 용도와 사용 예시를 IDE에서 바로 확인할 수 있습니다.
 *
 * @readonly
 * @enum {string}
 */
export enum RoomEvents {
  /**
   * 채팅 메시지 전송 이벤트.
   * @example
   * socket.emit(RoomEvents.MESSAGE, { sender: userId, message: '안녕하세요' });
   */
  MESSAGE = 'message',

  /**
   * 죽은 자들의 채팅 메시지 전송 이벤트.
   * @example
   * socket.emit(RoomEvents.CHAT_DEAD, { sender: userId, message: '나 뒤짐 ㅠㅠ' });
   */
  CHAT_DEAD = 'CHAT:DEAD',

  /**
   * 밤 사이 마피아 간의 채팅 메시지 전송 이벤트.
   * @example
   * socket.emit(RoomEvents.CHAT_MAFIA, { sender: userId, message: '1 쏘셈' });
   */
  CHAT_MAFIA = 'CHAT:MAFIA',

  /**
   * 방 정보 업데이트 이벤트.
   * @example
   * server.to(roomId).emit(RoomEvents.ROOM_UPDATED, roomData);
   */
  ROOM_UPDATED = 'ROOM:UPDATED',

  /**
   * 클라이언트에게 자신의 역할을 전달하는 이벤트.
   * @example
   * socket.emit(RoomEvents.YOUR_ROLE, { role: playerRole });
   */
  YOUR_ROLE = 'YOUR:ROLE',

  /**
   * 1차 투표 시작을 활성화하는 이벤트.
   * @example
   * server.to(roomId).emit(RoomEvents.VOTE_FIRST_ENABLE);
   */
  VOTE_FIRST_ENABLE = 'VOTE:FIRST:ENABLE',

  /**
   * 1차 투표 결과에 따른 효과(예: 최다 득표자 강조)를 보여주는 이벤트.
   * @example
   * server.to(roomId).emit(RoomEvents.VOTE_FIRST_TARGET_EFFECT, { winnerId, voteCount });
   */
  VOTE_FIRST_TARGET_EFFECT = 'VOTE:FIRST:TARGET:EFFECT',

  /**
   * 밤 단계로 전환될 때 발생하는 이벤트.
   * @example
   * server.to(roomId).emit(RoomEvents.NIGHT_PHASE, { message: '밤 단계로 전환합니다.' });
   */
  NIGHT_PHASE = 'NIGHT:PHASE',

  /**
   * 2차 투표에서 동률이 발생했을 때 전송되는 이벤트.
   * @example
   * server.to(roomId).emit(RoomEvents.VOTE_SECOND_TIE, { targetId });
   */
  VOTE_SECOND_TIE = 'VOTE:SECOND:TIE',

  /**
   * 2차 투표 결과 사형이 결정되었을 때 해당 플레이어가 사망 처리되었음을 알리는 이벤트.
   * @example
   * server.to(roomId).emit(RoomEvents.VOTE_SECOND_DEAD, { targetId });
   */
  VOTE_SECOND_DEAD = 'VOTE:SECOND:DEAD',

  /**
   * 밤 단계 배경 업데이트 이벤트.
   * @example
   * server.to(roomId).emit(RoomEvents.NIGHT_BACKGROUND, { message: '밤 배경 업데이트' });
   */
  NIGHT_BACKGROUND = 'NIGHT:BACKGROUND',

  /**
   * 투표 처리 중 에러가 발생했을 때 전송되는 이벤트.
   * @example
   * client.emit(RoomEvents.VOTE_ERROR, { message: '투표 처리 에러' });
   */
  VOTE_ERROR = 'VOTE:ERROR',

  /**
   * 내 직업, 생존 여부 전달 정보를 전송되는 이벤트.
   * @example
   * this.server.to(userId).emit(RoomEvents.MY_INFO, data);
   */
  MY_INFO = 'MY:INFO',

  /**
   * 에러가 발생했을 때 전송되는 이벤트.
   * @example
   * server.to(roomId).emit(RoomEvents.ERROR, { message: error.message });
   */
  ERROR = 'error',

  /**
   * 투표 결과의 최다 득표자 정보를 전송하는 이벤트.
   * @example
   * this.server.to(roomId).emit(RoomEvents.VOTE_SURVIVAL, { winnerId: finalResult.winnerId, voteCount: finalResult.voteCount,});
   */
  VOTE_SURVIVAL = 'VOTE:SURVIVAL',

  /**
   * 게임 종료후 결과를 알려주는 이벤트.
   * @example
   *  this.server.to(roomId).emit(RoomEvents.GAME_END, endResult);
   */
  GAME_END = 'GAME:END',

  /**
   * 밤 시작을 알리는 이벤트
   * @example
   * this.server.to(data.roomId).emit(RoomEvents.ROOM_NIGHT_START, {data.roomId,nightNumber,message: '밤이 시작되었습니다. 각자의 직업은 행동을 계시'});
   */
  ROOM_NIGHT_START = 'ROOM:NIGHT_START',

  /**
   * 마피아가 사살할 대상을 선택 했을떄 이벤트
   * @example
   * client.emit(RoomEvents.ACTION_MAFIA_TARGET, { message: '마피아 대상 선택 완료' });
   */
  ACTION_MAFIA_TARGET = 'ACTION:MAFIA_TARGET',

  /**
   * 의사가 보호할 대상을 선택 했을떄 이벤트
   * @example
   * client.emit(RoomEvents.ACTION_DOCTOR_TARGET, { message: '보호 대상 선택 완료' });
   */
  ACTION_DOCTOR_TARGET = 'ACTION:DOCTOR_TARGET',

  /**
   * 경찰이 조사할 대상을 선택 했을떄 이벤트
   * @example
   * client.emit(RoomEvents.ACTION_POLICE_TARGET, { message: '조사 대상 선택 완료' });
   */
  ACTION_POLICE_TARGET = 'ACTION:POLICE_TARGET',

  /**
   * 경찰이 조사한 결과를 알리는 이벤트.
   * @example
   * client.emit(RoomEvents.POLICE_RESULT, {roomId, targetUserId, role});
   */
  POLICE_RESULT = 'POLICE:RESULT',

  /**
   * 밤의 결과를 모두에게 알리는 이벤트.
   * @example
   * this.server.to(data.roomId).emit(RoomEvents.ROOM_NIGHT_RESULT, {roomId, result, message: `밤 결과: ${night.data}`,});
   */
  ROOM_NIGHT_RESULT = 'ROOM:NIGHT_RESULT',
  
}
