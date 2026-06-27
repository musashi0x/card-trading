/**
 * Shared structured logger for the API.
 *
 * One pino instance used everywhere: pure JSON on stdout in production (so the
 * platform's log collector can parse it), pretty-printed in development for
 * readability. The minimum severity is driven by `LOG_LEVEL` (default `info`).
 *
 * `redact` masks secrets and sensitive material before they ever hit the output
 * stream — auth/cookie headers, Stellar secret keys, signed transaction XDR, and
 * passkey/relay credentials — so a stray `log.info(obj)` can't leak them.
 */

import pino from 'pino';
import { env } from './env.js';

const isProd = process.env.NODE_ENV === 'production';

export const logger = pino({
  level: env.logLevel,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      // Secret keys / arbiter & issuer secrets, at the top level or one nested in.
      'secret',
      '*.secret',
      'arbiterSecret',
      '*.arbiterSecret',
      'usdcIssuerSecret',
      '*.usdcIssuerSecret',
      // Signed transaction XDR (never log a user's signed envelope).
      'signedXdr',
      '*.signedXdr',
      'xdr',
      '*.xdr',
      // Passkey / relay credentials.
      'channelsApiKey',
      '*.channelsApiKey',
      'launchtubeJwt',
      '*.launchtubeJwt',
    ],
    censor: '[REDACTED]',
  },
  ...(isProd
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:HH:MM:ss',
            ignore: 'pid,hostname',
            singleLine: true,
          },
        },
      }),
});
