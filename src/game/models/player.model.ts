// src/game/models/player.model.ts
export interface Player {
  id: number;
  userId: number;
  username: string;
  roomId: string;
  // role은 선택적(optional)로 선언되어, 값이 없으면 undefined
  role?: 'mafia' | 'citizen' | 'police' | 'doctor';
  isAlive: boolean;
}
