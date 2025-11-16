
export interface PlayerData {
  id: string;
  x: number;
  y: number;
  z: number;
  rotY: number;
  lastUpdate: number;
}

export interface BlastData {
  id: string;
  playerId: string;
  position: { x: number; y: number; z: number };
  direction: { x: number; y: number; z: number };
  timestamp: number;
}
