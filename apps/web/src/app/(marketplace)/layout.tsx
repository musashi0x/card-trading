'use client';

import type { ReactNode } from 'react';
import { TopDeckProvider } from '@/components/topdeck/TopDeckProvider';
import { Shell } from '@/components/topdeck/shell/Shell';

/**
 * The marketplace route group. The provider wires real data + wallet and holds
 * the shared UI state above every route; the shell renders the top nav and
 * global modals. Each screen is now its own URL under this group.
 */
export default function MarketplaceLayout({ children }: { children: ReactNode }) {
  return (
    <TopDeckProvider>
      <Shell>{children}</Shell>
    </TopDeckProvider>
  );
}
