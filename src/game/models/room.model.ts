// src/game/models/room.model.ts
export interface Room {
  id: number;
  hostId: number;
  roomName: string;
  status: 'waiting' | 'in-progress' | 'finished';
  settings: {
    maxPlayers: number;
    gameMode?: string;
  };
  createdAt: string; // ISO 8601 형식 (예: "2025-02-12T12:34:56.789Z")
}
