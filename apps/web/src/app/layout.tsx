import type { Metadata } from 'next';
import './globals.css';
import { QueryProvider } from '@/components/QueryProvider';
import { WalletProvider } from '@/components/WalletProvider';
import { DevAnnotations } from '@/components/DevAnnotations';

export const metadata: Metadata = {
  title: 'TopDeck — bid, win, collect',
  description: 'Auction trading cards with on-chain escrow and atomic settlement on Stellar.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        {/* eslint-disable-next-line @next/next/google-font-preconnect */}
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700;12..96,800&family=DM+Sans:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <WalletProvider>{children}</WalletProvider>
        <DevAnnotations />
      </body>
    </html>
  );
}
