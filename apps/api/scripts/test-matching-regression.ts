#!/usr/bin/env tsx
/**
 * Regression test for song matching
 *
 * Ensures that different input messages result in different song matches,
 * and that embeddings are non-zero and vary across inputs.
 *
 * Usage:
 *   DATABASE_URL="..." OPENAI_API_KEY="..." pnpm tsx scripts/test-matching-regression.ts
 */

import 'dotenv/config';
import { prisma } from '../src/services/database.js';
import { SemanticSearcher } from '../src/engine/matchers/semantic.js';
import { getEmbeddingService } from '../src/embeddings/index.js';
import { logger } from '../src/config/index.js';

const TEST_MESSAGES = [
  "happy birthday party celebration",
  "feeling sad and lonely tonight",
  "lets dance all night long baby",
  "rock and roll forever",
  "classical music piano symphony"
];

interface TestResult {
  message: string;
  embeddingStats: {
    dimensions: number;
    l2Norm: number;
    isZero: boolean;
    first5: number[];
  };
  topMatch: {
    title: string;
    artist: string;
    similarity: number;
  };
}

async function runMatchingTest(): Promise<void> {
  logger.info('🧪 Starting song matching regression test');

  try {
    await prisma.$connect();

    // Initialize semantic searcher
    const searcher = new SemanticSearcher(prisma, {
      knn_size: 10
    });

    // Initialize embedding service
    const embeddingService = await getEmbeddingService({
      primaryProvider: 'openai',
      openai: {
        apiKey: process.env.OPENAI_API_KEY!,
        model: 'text-embedding-3-small',
        dimensions: 1536
      }
    });

    const results: TestResult[] = [];

    // Test each message
    for (const message of TEST_MESSAGES) {
      logger.info(`Testing: "${message}"`);

      // Generate embedding
      const embedding = await embeddingService.embedSingle(message);

      // Calculate stats
      const l2Norm = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
      const isZero = embedding.every(val => val === 0);

      // Get top match
      const matches = await searcher.findSimilar(message, 5);

      if (matches.length === 0) {
        throw new Error(`No matches found for: "${message}"`);
      }

      const result: TestResult = {
        message,
        embeddingStats: {
          dimensions: embedding.length,
          l2Norm,
          isZero,
          first5: embedding.slice(0, 5)
        },
        topMatch: {
          title: matches[0].title,
          artist: matches[0].artist,
          similarity: matches[0].similarity
        }
      };

      results.push(result);

      logger.info({
        message,
        topMatch: `${result.topMatch.artist} - ${result.topMatch.title}`,
        similarity: result.topMatch.similarity.toFixed(4),
        embeddingNorm: l2Norm.toFixed(6)
      }, 'Test result');
    }

    // Verify results
    logger.info('\\n=== Verification ===');

    // Check 1: All embeddings are non-zero
    const allNonZero = results.every(r => !r.embeddingStats.isZero);
    logger.info(`✓ All embeddings non-zero: ${allNonZero ? 'PASS' : 'FAIL'}`);

    if (!allNonZero) {
      throw new Error('FAIL: Some embeddings are all zeros');
    }

    // Check 2: All embeddings have correct dimensions
    const allCorrectDims = results.every(r => r.embeddingStats.dimensions === 1536);
    logger.info(`✓ All embeddings have 1536 dimensions: ${allCorrectDims ? 'PASS' : 'FAIL'}`);

    if (!allCorrectDims) {
      throw new Error('FAIL: Some embeddings have wrong dimensions');
    }

    // Check 3: Embeddings vary (L2 norms should differ)
    const norms = results.map(r => r.embeddingStats.l2Norm);
    const uniqueNorms = new Set(norms.map(n => n.toFixed(4)));
    const normsVary = uniqueNorms.size > 1;
    logger.info(`✓ Embedding L2 norms vary (${uniqueNorms.size} unique): ${normsVary ? 'PASS' : 'FAIL'}`);

    if (!normsVary) {
      logger.warn('WARNING: All L2 norms are identical, embeddings may not be varying');
    }

    // Check 4: Top matches vary (at least some different songs)
    const topMatches = results.map(r => `${r.topMatch.artist} - ${r.topMatch.title}`);
    const uniqueMatches = new Set(topMatches);
    const matchesVary = uniqueMatches.size > 1;
    logger.info(`✓ Top matches vary (${uniqueMatches.size} unique songs): ${matchesVary ? 'PASS' : 'FAIL'}`);

    if (!matchesVary) {
      logger.error('FAIL: All messages matched the same song!');
      logger.error({ topMatches }, 'Top matches');
      throw new Error('FAIL: All messages matched the same song');
    }

    // Check 5: First 5 embedding values differ across tests
    const first5Sets = results.map(r => JSON.stringify(r.embeddingStats.first5.map(v => v.toFixed(6))));
    const uniqueFirst5 = new Set(first5Sets);
    const first5Vary = uniqueFirst5.size > 1;
    logger.info(`✓ First 5 embedding values vary: ${first5Vary ? 'PASS' : 'FAIL'}`);

    if (!first5Vary) {
      logger.error('FAIL: First 5 embedding values are identical across all tests');
      throw new Error('FAIL: Embeddings appear to be constant');
    }

    // Print summary table
    logger.info('\\n=== Results Summary ===');
    logger.info('Message'.padEnd(40) + 'Top Match'.padEnd(40) + 'Similarity');
    logger.info('='.repeat(90));

    for (const result of results) {
      const msg = result.message.substring(0, 38).padEnd(40);
      const match = `${result.topMatch.artist} - ${result.topMatch.title}`.substring(0, 38).padEnd(40);
      const sim = result.topMatch.similarity.toFixed(4);
      logger.info(`${msg}${match}${sim}`);
    }

    logger.info('\\n✅ All regression tests passed!');
    process.exit(0);

  } catch (error: any) {
    logger.error({ error: error.message }, '❌ Regression test failed');
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runMatchingTest();
