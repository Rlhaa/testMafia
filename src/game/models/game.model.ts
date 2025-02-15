// src/game/models/game.model.ts
export interface Game {
  id: number;
  roomId: string;
  round: number;
  playersId: number[];
  isNight: boolean;
  targetIds: number[];
  aliveIds: number[];
  deadIds: number[];
  isVote: boolean;
  // 추가 필드: 야간 행동, 투표 기록 등
  mafiaActions?: { [userId: number]: number };
  doctorAction?: number;
  policeAction?: number;
  voteRecords?: { voterId: number; targetId: number }[];
}
