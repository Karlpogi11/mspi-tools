// Monthly leaderboard readiness: the current month's board unlocks on the 26th
// (Asia/Manila) ahead of the end-of-month meeting and awarding. Before that,
// leaderboards default to the last finished month. Boards stay live until month-end.

export function manilaParts(): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Manila' }).format(new Date()).split('-');
  return { year: Number(parts[0]), month: Number(parts[1]), day: Number(parts[2]) };
}

export function manilaMonth(): string {
  const { year, month } = manilaParts();
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function shiftMonth(month: string, delta: number): string {
  const [year, mon] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, mon - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Latest viewable board month: the current month is always visible, but names stay
 *  hidden (suspense) until it closes. Past months are fully open. */
export function leaderboardMaxMonth(): string {
  return manilaMonth();
}

/** True once this month's board is unlocked (26th onwards, Manila). */
export function isCurrentBoardReady(): boolean {
  return manilaParts().day >= 26;
}

function seenKey(month: string) {
  return `mspi-leaderboard-seen-${month}`;
}

export function hasSeenLeaderboard(month: string): boolean {
  try {
    return window.localStorage.getItem(seenKey(month)) === '1';
  } catch {
    return false;
  }
}

export function markLeaderboardSeen(month: string): void {
  try {
    window.localStorage.setItem(seenKey(month), '1');
  } catch {
    // Seen-state is optional.
  }
}
