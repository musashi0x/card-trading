/**
 * Sponsoring-relay abstraction for passkey smart-wallet checkout.
 *
 * Passkey-signed transactions are submitted through a fee-sponsoring relay so
 * the consumer never needs XLM. The relay is abstracted behind `RelaySubmitter`
 * so the provider can be swapped without touching the route:
 *   - `channels`   — OpenZeppelin Relayer Channels (current; via passkey-kit's
 *                    PasskeyServer.send, which wraps the Channels client)
 *   - `launchtube` — the legacy Launchtube service (superseded by Channels),
 *                    kept as a documented fallback
 *
 * A `RelayError` carries a machine code so the route can return a structured
 * `ApiError` and leave DB state untouched on failure.
 */

import { PasskeyServer } from 'passkey-kit';
import { env } from './env.js';

export interface RelayResult {
  hash: string;
  successful: boolean;
}

export interface RelaySubmitter {
  /** Relay a signed Soroban transaction (XDR); resolves once it is on-chain. */
  submit(signedXdr: string): Promise<RelayResult>;
}

export class RelayError extends Error {
  status = 502;
  constructor(
    message: string,
    public code: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

/** OpenZeppelin Channels relay, via passkey-kit's server client. */
class ChannelsRelay implements RelaySubmitter {
  private readonly server: PasskeyServer;

  constructor() {
    this.server = new PasskeyServer({
      rpcUrl: env.stellar.rpcUrl,
      relayerUrl: env.passkey.channelsUrl,
      relayerApiKey: env.passkey.channelsApiKey,
    });
  }

  async submit(signedXdr: string): Promise<RelayResult> {
    try {
      const res = await this.server.send(signedXdr);
      if (!res.hash) {
        throw new RelayError('Relay returned no transaction hash', 'RELAY_FAILED', {
          provider: 'channels',
        });
      }
      return { hash: res.hash, successful: true };
    } catch (err) {
      if (err instanceof RelayError) throw err;
      throw new RelayError('Relay submission failed', 'RELAY_FAILED', {
        provider: 'channels',
        cause: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/** Legacy Launchtube relay: POST the XDR with a Bearer JWT. */
class LaunchtubeRelay implements RelaySubmitter {
  async submit(signedXdr: string): Promise<RelayResult> {
    const body = new URLSearchParams({ xdr: signedXdr });
    let res: Response;
    try {
      res = await fetch(env.passkey.launchtubeUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Bearer ${env.passkey.launchtubeJwt}`,
        },
        body,
      });
    } catch (err) {
      throw new RelayError('Relay request failed', 'RELAY_FAILED', {
        provider: 'launchtube',
        cause: err instanceof Error ? err.message : String(err),
      });
    }
    if (!res.ok) {
      throw new RelayError('Relay rejected the submission', 'RELAY_FAILED', {
        provider: 'launchtube',
        status: res.status,
      });
    }
    const json = (await res.json()) as { hash?: string };
    if (!json.hash) {
      throw new RelayError('Relay returned no transaction hash', 'RELAY_FAILED', {
        provider: 'launchtube',
      });
    }
    return { hash: json.hash, successful: true };
  }
}

let cached: RelaySubmitter | undefined;

/** The configured relay submitter (lazy singleton). */
export function relaySubmitter(): RelaySubmitter {
  if (!cached) {
    cached = env.passkey.relayProvider === 'launchtube' ? new LaunchtubeRelay() : new ChannelsRelay();
  }
  return cached;
}
