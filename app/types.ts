export type AppState =
  | 'idle'          // radio not playing
  | 'starting'      // connecting to stream
  | 'streaming'     // radio playing, awaiting sync
  | 'tap_radio'     // tap sync: waiting for radio tap
  | 'tap_tv'        // tap sync: radio marked, waiting for TV tap
  | 'synced'        // synced with offset applied
  | 'error';        // error

export interface PlaySummary {
  atBatIndex: number;
  inning: number;
  halfInning: 'top' | 'bottom';
  startTime: string;      // ISO 8601 — used to calculate tv_delay
  batter: string;
  pitcher: string;
  result: string;         // "Strikeout", "Single", "Home Run", etc.
  description: string;
  rbi: number;
  awayScore: number;
  homeScore: number;
  isComplete: boolean;
  isScoringPlay: boolean;
}

export interface GameRouteResponse {
  gamePk: number | null;
  gameState: 'Live' | 'Final' | 'Preview' | 'Postponed' | 'NoGame';
  currentInning: number;
  currentInningOrdinal: string;
  inningHalf: 'Top' | 'Bottom';
  awayTeam: string;
  homeTeam: string;
  awayScore: number;
  homeScore: number;
  plays: PlaySummary[];
}
