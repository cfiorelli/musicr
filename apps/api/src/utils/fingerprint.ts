/**
 * Instance fingerprint for debugging split-brain behavior
 *
 * Helps identify which API instance is handling requests
 * when multiple instances or mixed deployments exist.
 */

import os from 'os';
import { randomBytes } from 'crypto';

export interface InstanceFingerprint {
  instanceId: string;
  hostname: string;
  pid: number;
  bootTime: string;
  buildId: string;
  hasOpenAIKey: boolean;
  nodeVersion: string;
  uptime: number; // seconds since boot
}

export interface RequestFingerprint extends InstanceFingerprint {
  embeddingStatus: 'ok' | 'error' | 'zero' | 'missing_key' | 'not_attempted';
  embeddingNorm?: number;
  embeddingDimensions?: number;
}

// Generate a unique instance ID at boot time
const INSTANCE_BOOT_ID = randomBytes(4).toString('hex');
const INSTANCE_BOOT_TIME = new Date().toISOString();

/**
 * Get instance-level fingerprint (constant for this process)
 */
export function getInstanceFingerprint(): InstanceFingerprint {
  const hasOpenAIKey = !!process.env.OPENAI_API_KEY;
  const buildId = process.env.RAILWAY_DEPLOYMENT_ID ||
                  process.env.GIT_SHA ||
                  process.env.npm_package_version ||
                  'unknown';

  return {
    instanceId: `${os.hostname()}-${process.pid}-${INSTANCE_BOOT_ID}`,
    hostname: os.hostname(),
    pid: process.pid,
    bootTime: INSTANCE_BOOT_TIME,
    buildId,
    hasOpenAIKey,
    nodeVersion: process.version,
    uptime: Math.floor(process.uptime())
  };
}

/**
 * Create request-specific fingerprint with embedding status
 */
export function createRequestFingerprint(
  embeddingStatus: RequestFingerprint['embeddingStatus'],
  embeddingData?: { norm?: number; dimensions?: number }
): RequestFingerprint {
  const instance = getInstanceFingerprint();

  return {
    ...instance,
    embeddingStatus,
    embeddingNorm: embeddingData?.norm,
    embeddingDimensions: embeddingData?.dimensions
  };
}

/**
 * Format fingerprint for logging (excludes sensitive data)
 */
export function formatFingerprint(fp: InstanceFingerprint | RequestFingerprint): string {
  const parts = [
    `instance=${fp.instanceId}`,
    `build=${fp.buildId}`,
    `hasKey=${fp.hasOpenAIKey}`,
    `uptime=${fp.uptime}s`
  ];

  if ('embeddingStatus' in fp) {
    parts.push(`embeddingStatus=${fp.embeddingStatus}`);
    if (fp.embeddingNorm !== undefined) {
      parts.push(`norm=${fp.embeddingNorm.toFixed(4)}`);
    }
  }

  return parts.join(' ');
}
