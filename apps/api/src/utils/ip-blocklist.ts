/**
 * Emergency IP blocklist — env-based, no DB required.
 *
 * Set BLOCKED_IPS='1.2.3.4,5.6.7.8' in Railway environment variables.
 * Takes effect on next deploy or process restart (env reload).
 *
 * Works for both HTTP routes and WebSocket upgrade requests because Fastify's
 * onRequest hook fires before the WS handshake completes.
 */

function parseBlocklist(): Set<string> {
  const raw = process.env.BLOCKED_IPS ?? '';
  if (!raw.trim()) return new Set();
  return new Set(
    raw.split(',').map(ip => ip.trim()).filter(Boolean)
  );
}

// Evaluated once at startup. To pick up changes, redeploy or restart.
const blocklist: Set<string> = parseBlocklist();

if (blocklist.size > 0) {
  // Use console.warn — visible before the Pino logger is fully configured.
  console.warn(`[ip-blocklist] Active: blocking ${blocklist.size} IP(s)`);
}

export function isBlocked(ip: string): boolean {
  return blocklist.has(ip);
}

export function getBlockedCount(): number {
  return blocklist.size;
}
