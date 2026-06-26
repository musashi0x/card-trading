'use client';

/**
 * Agentation — in-browser visual annotation toolbar (dev only).
 *
 * Click elements in the running app to leave annotations; they sync to the
 * Agentation MCP server (default http://localhost:4747) so an AI coding agent
 * (Claude Code) can read and act on them. Local-first: works offline and syncs
 * when the server is up. Rendered only in development.
 */

import { Agentation } from 'agentation';

export function DevAnnotations() {
  if (process.env.NODE_ENV !== 'development') return null;
  return <Agentation endpoint="http://localhost:4747" />;
}
