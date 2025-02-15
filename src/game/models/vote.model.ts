// src/game/models/vote.model.ts
export interface Vote {
  id: number;
  voterIds: number[];
  targetIds: number[];
  day: number;
}
