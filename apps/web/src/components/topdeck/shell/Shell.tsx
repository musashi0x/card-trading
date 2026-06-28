'use client';

import { useEffect, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { useTopDeck } from '../TopDeckProvider';
import { INK, SANS } from '../theme';
import { TopNav } from './TopNav';
import { Toast } from '../shared/Toast';
import { BidModal } from '../shared/BidModal';
import { GuideModal } from '../shared/GuideModal';
import { SigningLoader } from '../shared/SigningLoader';

/**
 * The page chrome shared by every route: the sticky top nav, the routed page
 * body, and the global bid modal + toast. A pathname-keyed effect scrolls to the
 * top on navigation (replacing the per-handler `window.scrollTo` the old class
 * sprinkled through its navigation methods).
 */
export function Shell({ children }: { children: ReactNode }) {
  const td = useTopDeck();
  const pathname = usePathname();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  const sel = td.getCard(td.state.selectedId);

  return (
    <div style={{ minHeight: '100vh', background: '#fff7ec', fontFamily: SANS, color: INK }}>
      <TopNav />
      {children}
      {td.state.bidOpen && sel && <BidModal card={sel} />}
      <GuideModal />
      <SigningLoader />
      <Toast />
    </div>
  );
}
