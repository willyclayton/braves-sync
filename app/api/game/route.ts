/**
 * /api/game — Live Braves game data from MLB Stats API.
 *
 * Returns current game status and completed plays for the Game Timeline sync feature.
 * MLB games are scheduled in Eastern Time, so we use ET for the date query.
 */

import type { GameRouteResponse, PlaySummary } from '@/app/types';

export const runtime = 'edge';

function getEasternDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
  }).format(new Date()); // → "2026-04-12"
}

const EMPTY: GameRouteResponse = {
  gamePk: null,
  gameState: 'NoGame',
  currentInning: 1,
  currentInningOrdinal: '1st',
  inningHalf: 'Top',
  awayTeam: 'ATL',
  homeTeam: '',
  awayScore: 0,
  homeScore: 0,
  plays: [],
};

export async function GET(): Promise<Response> {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

  try {
    const date = getEasternDate();
    const schedRes = await fetch(
      `https://statsapi.mlb.com/api/v1/schedule?sportId=1&teamId=144&date=${date}&hydrate=linescore`,
      { headers: { Accept: 'application/json' } },
    );
    if (!schedRes.ok) return Response.json(EMPTY, { headers });

    const sched = await schedRes.json();
    const games: any[] = sched.dates?.[0]?.games ?? [];
    if (games.length === 0) return Response.json(EMPTY, { headers });

    // Prefer in-progress game; fall back to most-recently-completed
    const game =
      games.find((g) => g.status?.abstractGameState === 'Live') ??
      games.find((g) => g.status?.abstractGameState === 'Final') ??
      games[0];

    const abstractState: string = game.status?.abstractGameState ?? '';
    const gameState: GameRouteResponse['gameState'] =
      abstractState === 'Live'
        ? 'Live'
        : abstractState === 'Final'
        ? 'Final'
        : abstractState === 'Preview'
        ? 'Preview'
        : 'NoGame';

    const ls = game.linescore ?? {};
    const currentInning: number = ls.currentInning ?? 1;
    const currentInningOrdinal: string = ls.currentInningOrdinal ?? '1st';
    const inningHalf: 'Top' | 'Bottom' =
      ls.inningHalf === 'Bottom' ? 'Bottom' : 'Top';

    const awayTeam: string = game.teams?.away?.team?.abbreviation ?? 'ATL';
    const homeTeam: string = game.teams?.home?.team?.abbreviation ?? '';
    const awayScore: number = game.teams?.away?.score ?? 0;
    const homeScore: number = game.teams?.home?.score ?? 0;

    let plays: PlaySummary[] = [];

    if (gameState === 'Live' || gameState === 'Final') {
      try {
        const pbpRes = await fetch(
          `https://statsapi.mlb.com/api/v1/game/${game.gamePk}/playByPlay`,
        );
        if (pbpRes.ok) {
          const pbp = await pbpRes.json();
          plays = (pbp.allPlays ?? [])
            .filter((p: any) => p.about?.isComplete === true)
            .map(
              (p: any): PlaySummary => ({
                atBatIndex: p.about?.atBatIndex ?? 0,
                inning: p.about?.inning ?? 1,
                halfInning: p.about?.halfInning === 'bottom' ? 'bottom' : 'top',
                startTime: p.about?.startTime ?? '',
                batter: p.matchup?.batter?.fullName ?? 'Unknown',
                pitcher: p.matchup?.pitcher?.fullName ?? 'Unknown',
                result: p.result?.event ?? '',
                description: p.result?.description ?? '',
                rbi: p.result?.rbi ?? 0,
                awayScore: p.result?.awayScore ?? 0,
                homeScore: p.result?.homeScore ?? 0,
                isComplete: true,
                isScoringPlay: p.about?.isScoringPlay ?? false,
              }),
            );
        }
      } catch {
        // play-by-play unavailable — return partial data
      }
    }

    const response: GameRouteResponse = {
      gamePk: game.gamePk ?? null,
      gameState,
      currentInning,
      currentInningOrdinal,
      inningHalf,
      awayTeam,
      homeTeam,
      awayScore,
      homeScore,
      plays,
    };

    return Response.json(response, { headers });
  } catch {
    return Response.json(EMPTY, { headers });
  }
}
