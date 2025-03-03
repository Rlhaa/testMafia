export interface Achievements {
  id: number;
  name: string;
  description: string;
  criteria: { action: string; count: number };
  reward: { points: number; badge: string };
  achieved: boolean;
}
