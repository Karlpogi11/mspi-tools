import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { hasSeenLeaderboard, isCurrentBoardReady, manilaMonth } from '../lib/leaderboard';

export default function LeaderboardTrophy() {
  const [showBadge, setShowBadge] = useState(false);
  useEffect(() => {
    const check = () => setShowBadge(isCurrentBoardReady() && !hasSeenLeaderboard(manilaMonth()));
    check();
    window.addEventListener('focus', check);
    return () => window.removeEventListener('focus', check);
  }, []);
  return (
    <Link to="/leaderboards" aria-label="Open leaderboards" title="Leaderboards" className="relative flex h-9 w-9 items-center justify-center rounded-full border border-[#d2d2d7] text-[#3c3c43] hover:bg-[#f5f5f7]">
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9H4.5a2.5 2.5 0 010-5H6" /><path d="M18 9h1.5a2.5 2.5 0 000-5H18" /><path d="M4 2h16" /><path d="M12 2v2" /><path d="M8 4h8l-1 7a3 3 0 01-6 0L8 4z" /><path d="M12 14v3" /><path d="M8.5 20h7" /><path d="M9.5 17h5" /></svg>
      {showBadge && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-[#c9a927] ring-2 ring-white" aria-label="New leaderboard ready" role="status" />}
    </Link>
  );
}
