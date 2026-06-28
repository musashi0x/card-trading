'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTopDeck } from '@/components/topdeck/TopDeckProvider';
import { INK, DISPLAY, SANS } from '@/components/topdeck/theme';
import { money, shorten } from '@/components/topdeck/lib';
import { api } from '@/lib/api';
import { signXdr } from '@/lib/wallet';
import BoltIcon from '@mui/icons-material/Bolt';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import WarningIcon from '@mui/icons-material/Warning';

export default function FaucetPage() {
  const td = useTopDeck();
  const connectedAddress = td.wallet.address;
  const isConnecting = td.wallet.connecting;

  const [targetAddress, setTargetAddress] = useState('');
  const [amount, setAmount] = useState('1000');
  const [loading, setLoading] = useState(false);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [balances, setBalances] = useState<{ usdc: string; xlm: string; usdcTrustline: boolean } | null>(null);

  // UX State
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successTx, setSuccessTx] = useState<{ hash: string; amount: string; address: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [trustlineSigning, setTrustlineSigning] = useState(false);

  // Sync target address with connected wallet on load or connect
  useEffect(() => {
    if (connectedAddress) {
      setTargetAddress(connectedAddress);
    }
  }, [connectedAddress]);

  // Load balances for the target address
  const loadBalances = useCallback(async (addr: string) => {
    if (!addr || !/^[CG][A-Z2-7]{55}$/.test(addr)) {
      setBalances(null);
      return;
    }
    setBalanceLoading(true);
    try {
      const data = await api.devGetBalance(addr);
      setBalances(data);
      setErrorMsg(null);
    } catch (err) {
      console.error('[faucet] failed to load balances:', err);
      // Don't show critical error for invalid/unfunded accounts since the faucet can self-heal
      setBalances({ usdc: '0', xlm: '0', usdcTrustline: false });
    } finally {
      setBalanceLoading(false);
    }
  }, []);

  // Reload balances when targetAddress changes
  useEffect(() => {
    void loadBalances(targetAddress);
  }, [targetAddress, loadBalances]);

  const copyToClipboard = () => {
    if (!targetAddress) return;
    void navigator.clipboard.writeText(targetAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleEstablishTrustline = async (xdr: string, passphrase: string) => {
    if (!connectedAddress) {
      setErrorMsg('Please connect your classic wallet first to sign the trustline.');
      return;
    }
    if (connectedAddress !== targetAddress) {
      setErrorMsg('You can only establish a trustline for your currently connected wallet.');
      return;
    }
    setTrustlineSigning(true);
    setErrorMsg(null);
    try {
      const signed = await signXdr(xdr, connectedAddress, passphrase);
      const { hash } = await api.submitClassic(signed);
      // Wait a moment for transaction confirmation to reflect
      await new Promise((resolve) => setTimeout(resolve, 2000));
      await loadBalances(targetAddress);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to sign and submit trustline.');
    } finally {
      setTrustlineSigning(false);
    }
  };

  const handleClaim = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetAddress) return;

    setLoading(true);
    setErrorMsg(null);
    setSuccessTx(null);

    try {
      const res = await api.devFundWallet(targetAddress, amount);
      setSuccessTx({ hash: res.hash, amount: res.amountUsdc, address: res.wallet });
      void loadBalances(targetAddress);
    } catch (err: any) {
      if (err.code === 'MISSING_TRUSTLINE' && err.details?.xdr) {
        // We caught a missing trustline, present it as a clear action
        setErrorMsg('MISSING_TRUSTLINE');
        // Cache the details for trustline submission
        (window as any)._pendingTrustlineXdr = err.details.xdr;
        (window as any)._pendingTrustlinePassphrase = err.details.networkPassphrase;
      } else {
        setErrorMsg(err.message || 'An error occurred while funding the wallet.');
      }
    } finally {
      setLoading(false);
    }
  };

  const isClassicAndMissingTrustline =
    targetAddress.startsWith('G') &&
    balances &&
    !balances.usdcTrustline;

  const isNewAccount =
    targetAddress.startsWith('G') &&
    balances &&
    Number(balances.xlm) === 0;

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '40px 24px 100px', fontFamily: SANS }}>
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <h1 style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 42, color: INK, margin: '0 0 8px 0', letterSpacing: '-.02em' }}>
          USDC Faucet
        </h1>
        <p style={{ fontSize: 15, color: 'rgba(26,19,5,.6)', fontWeight: 500, margin: 0 }}>
          Mint mock USDC tokens directly to any Stellar testnet account.
        </p>
      </div>

      {/* Main Box */}
      <div style={{ background: '#fff', border: `3px solid ${INK}`, borderRadius: 18, boxShadow: `6px 6px 0 ${INK}`, padding: 32, overflow: 'hidden' }}>

        {/* Connection status shortcut */}
        {!connectedAddress && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#ffd84d', border: `2.5px solid ${INK}`, borderRadius: 12, padding: '14px 20px', marginBottom: 24, boxShadow: `2.5px 2.5px 0 ${INK}` }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: INK }}>
              Connect your wallet to quickly autofill your address.
            </div>
            <div
              onClick={() => void td.wallet.connect()}
              style={{ fontSize: 12.5, fontWeight: 800, padding: '8px 16px', background: INK, color: '#fff', border: `2px solid ${INK}`, borderRadius: 8, cursor: 'pointer', userSelect: 'none' }}
            >
              {isConnecting ? 'Connecting...' : 'Connect Wallet'}
            </div>
          </div>
        )}

        <form onSubmit={handleClaim}>
          {/* Target Address Input */}
          <div style={{ marginBottom: 24 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 800, color: INK, letterSpacing: '.05em', marginBottom: 8 }}>
              STELLAR RECIPIENT ADDRESS
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="text"
                value={targetAddress}
                onChange={(e) => setTargetAddress(e.target.value.trim())}
                placeholder="G... or C..."
                required
                style={{ flex: 1, padding: '12px 16px', fontSize: 14, fontFamily: 'monospace', border: `2.5px solid ${INK}`, borderRadius: 10, outline: 'none', background: '#fff' }}
              />
              {targetAddress && (
                <button
                  type="button"
                  onClick={copyToClipboard}
                  title="Copy address"
                  style={{ width: 48, height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fff', border: `2.5px solid ${INK}`, borderRadius: 10, cursor: 'pointer' }}
                >
                  <ContentCopyIcon sx={{ fontSize: 18, color: copied ? '#13c06a' : INK }} />
                </button>
              )}
            </div>
          </div>

          {/* Balance Preview Card */}
          {targetAddress && /^[CG][A-Z2-7]{55}$/.test(targetAddress) && (
            <div style={{ background: '#fff7ec', border: `2.5px solid ${INK}`, borderRadius: 12, padding: 18, marginBottom: 24 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: `1.5px solid rgba(26,19,5,.1)`, paddingBottom: 10, marginBottom: 12 }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: 'rgba(26,19,5,.6)', letterSpacing: '.04em' }}>
                  RECIPIENT ACCOUNT DETAILS
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 800, padding: '3px 8px', borderRadius: 6, background: INK, color: '#fff' }}>
                  {targetAddress.startsWith('C') ? (
                    <>
                      <BoltIcon sx={{ fontSize: 12, color: '#ffd84d' }} />
                      <span>Smart Wallet</span>
                    </>
                  ) : (
                    <span>Classic Wallet</span>
                  )}
                </span>
              </div>

              {balanceLoading ? (
                <div style={{ fontSize: 12.5, fontWeight: 600, color: 'rgba(26,19,5,.5)' }}>Loading network balances...</div>
              ) : balances ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: 'rgba(26,19,5,.5)' }}>USDC BALANCE</div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: INK }}>{Number(balances.usdc).toLocaleString()} USDC</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: 'rgba(26,19,5,.5)' }}>XLM BALANCE</div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: INK }}>{Number(balances.xlm).toLocaleString()} XLM</div>
                  </div>
                </div>
              ) : null}
            </div>
          )}

          {/* Amount Selector */}
          <div style={{ marginBottom: 24 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 800, color: INK, letterSpacing: '.05em', marginBottom: 8 }}>
              MINT AMOUNT
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
              {['100', '500', '1000'].map((amt) => {
                const isSelected = amount === amt;
                return (
                  <div
                    key={amt}
                    onClick={() => setAmount(amt)}
                    style={{
                      textAlign: 'center',
                      fontSize: 13.5,
                      fontWeight: 800,
                      padding: '11px 0',
                      cursor: 'pointer',
                      border: `2.5px solid ${INK}`,
                      borderRadius: 10,
                      background: isSelected ? INK : '#fff',
                      color: isSelected ? '#fff' : INK,
                      transition: 'transform 0.1s, box-shadow 0.1s',
                      boxShadow: isSelected ? 'none' : `2px 2px 0 ${INK}`,
                      transform: isSelected ? 'translate(1px, 1px)' : 'none',
                    }}
                  >
                    {Number(amt).toLocaleString()} USDC
                  </div>
                );
              })}
            </div>
          </div>

          {/* Custom warnings (Trustline/Friendbot) */}
          {isClassicAndMissingTrustline && errorMsg !== 'MISSING_TRUSTLINE' && (
            <div style={{ display: 'flex', gap: 12, background: '#fff0f0', border: `2px solid #ff4d3d`, borderRadius: 12, padding: '14px 16px', marginBottom: 24 }}>
              <WarningIcon sx={{ color: '#ff4d3d', fontSize: 20, flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 800, color: '#ff4d3d' }}>USDC Trustline Missing</div>
                <div style={{ fontSize: 12, color: 'rgba(26,19,5,.75)', marginTop: 2, lineHeight: 1.4 }}>
                  Classic wallets must trust the USDC asset code before they can receive tokens. You will be prompted to establish this trustline when you claim.
                </div>
              </div>
            </div>
          )}

          {isNewAccount && !isClassicAndMissingTrustline && (
            <div style={{ display: 'flex', gap: 12, background: '#eafaf1', border: `2px solid #13c06a`, borderRadius: 12, padding: '14px 16px', marginBottom: 24 }}>
              <WarningIcon sx={{ color: '#13c06a', fontSize: 20, flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 800, color: '#13c06a' }}>New Account Detected</div>
                <div style={{ fontSize: 12, color: 'rgba(26,19,5,.75)', marginTop: 2, lineHeight: 1.4 }}>
                  This address is not yet active on the Stellar blockchain. The faucet will automatically request Friendbot to fund it with XLM first!
                </div>
              </div>
            </div>
          )}

          {/* Success Banner */}
          {successTx && (
            <div style={{ background: '#eafaf1', border: `2.5px solid #13c06a`, borderRadius: 12, padding: 18, marginBottom: 24, display: 'flex', gap: 12 }}>
              <CheckCircleIcon sx={{ color: '#13c06a', fontSize: 22, flexShrink: 0, marginTop: 1 }} />
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 800, color: '#109b55' }}>Success! Minted {Number(successTx.amount).toLocaleString()} USDC</div>
                <div style={{ fontSize: 12, color: 'rgba(26,19,5,.7)', marginTop: 2, wordBreak: 'break-all' }}>
                  Successfully credited to {shorten(successTx.address)}.
                </div>
                <a
                  href={td.explorerAddress(successTx.hash)}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ display: 'inline-block', fontSize: 12, fontWeight: 700, color: '#2d5bff', textDecoration: 'underline', marginTop: 8 }}
                >
                  View Transaction ↗
                </a>
              </div>
            </div>
          )}

          {/* Error Banner */}
          {errorMsg && (
            <div style={{ background: '#fff0f0', border: `2.5px solid #ff4d3d`, borderRadius: 12, padding: 18, marginBottom: 24, display: 'flex', gap: 12 }}>
              {errorMsg === 'MISSING_TRUSTLINE' ? (
                <>
                  <WarningIcon sx={{ color: '#ff4d3d', fontSize: 22, flexShrink: 0, marginTop: 1 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 800, color: '#ff4d3d' }}>Trustline Required</div>
                    <div style={{ fontSize: 12.5, color: 'rgba(26,19,5,.75)', marginTop: 2, lineHeight: 1.45 }}>
                      Stellar accounts require an explicit trustline to receive non-native assets. Click below to sign the `change_trust` operation with your wallet extension.
                    </div>
                    <button
                      type="button"
                      disabled={trustlineSigning}
                      onClick={() => handleEstablishTrustline((window as any)._pendingTrustlineXdr, (window as any)._pendingTrustlinePassphrase)}
                      style={{
                        display: 'block',
                        marginTop: 12,
                        fontSize: 12.5,
                        fontWeight: 800,
                        padding: '8px 16px',
                        background: '#ff4d3d',
                        color: '#fff',
                        border: `2px solid ${INK}`,
                        borderRadius: 8,
                        boxShadow: `2px 2px 0 ${INK}`,
                        cursor: 'pointer',
                      }}
                    >
                      {trustlineSigning ? 'Signing trustline...' : 'Sign & Add Trustline'}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <WarningIcon sx={{ color: '#ff4d3d', fontSize: 22, flexShrink: 0 }} />
                  <div>
                    <div style={{ fontSize: 13.5, fontWeight: 800, color: '#ff4d3d' }}>Minting Failed</div>
                    <div style={{ fontSize: 12.5, color: 'rgba(26,19,5,.75)', marginTop: 2 }}>{errorMsg}</div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Action Button */}
          {errorMsg !== 'MISSING_TRUSTLINE' && (
            <button
              type="submit"
              disabled={loading || !targetAddress || !/^[CG][A-Z2-7]{55}$/.test(targetAddress)}
              style={{
                width: '100%',
                fontFamily: DISPLAY,
                fontSize: 15,
                fontWeight: 800,
                padding: '14px 0',
                background: '#ffd84d',
                color: INK,
                border: `3px solid ${INK}`,
                borderRadius: 12,
                boxShadow: (loading || !targetAddress || !/^[CG][A-Z2-7]{55}$/.test(targetAddress)) ? 'none' : `3.5px 3.5px 0 ${INK}`,
                cursor: (loading || !targetAddress || !/^[CG][A-Z2-7]{55}$/.test(targetAddress)) ? 'not-allowed' : 'pointer',
                transform: loading ? 'translate(2px, 2px)' : 'none',
                opacity: (loading || !targetAddress || !/^[CG][A-Z2-7]{55}$/.test(targetAddress)) ? 0.6 : 1,
                transition: 'transform 0.1s, box-shadow 0.1s',
              }}
            >
              {loading ? 'Minting USDC...' : 'Claim USDC'}
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
