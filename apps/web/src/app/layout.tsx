import type { Metadata } from 'next';
import './globals.css';
import { Nav } from '@/components/Nav';
import { WalletProvider } from '@/components/WalletProvider';

export const metadata: Metadata = {
  title: 'StellarCards — non-custodial card marketplace',
  description: 'Trade cards with on-chain escrow, atomic settlement, and instant refunds on Stellar.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <WalletProvider>
          <Nav />
          <main className="container">{children}</main>
        </WalletProvider>
      </body>
    </html>
  );
}
