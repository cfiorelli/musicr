import 'dotenv/config';
import { prisma } from '../src/services/database.js';
import { logger } from '../src/config/index.js';

/**
 * Phase 1 Verification Script
 *
 * Verifies:
 * 1. pgvector extension is enabled
 * 2. All tables exist
 * 3. Song count
 * 4. Sample 3 embeddings and verify non-zero norm
 * 5. Run similarity query for topK songs
 */

interface VerificationResult {
  step: string;
  success: boolean;
  details?: any;
  error?: string;
}

const results: VerificationResult[] = [];

async function verifyPgvectorExtension(): Promise<VerificationResult> {
  try {
    const result = await prisma.$queryRaw<Array<{ extname: string; extversion: string }>>`
      SELECT extname, extversion
      FROM pg_extension
      WHERE extname = 'vector'
    `;

    if (result.length > 0) {
      return {
        step: '1. pgvector extension',
        success: true,
        details: { version: result[0].extversion }
      };
    } else {
      return {
        step: '1. pgvector extension',
        success: false,
        error: 'pgvector extension not found'
      };
    }
  } catch (error: any) {
    return {
      step: '1. pgvector extension',
      success: false,
      error: error.message
    };
  }
}

async function verifyTables(): Promise<VerificationResult> {
  try {
    const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public'
      ORDER BY tablename
    `;

    const expectedTables = ['messages', 'rooms', 'songs', 'users'];
    const tableNames = tables.map(t => t.tablename);
    const missingTables = expectedTables.filter(t => !tableNames.includes(t));

    if (missingTables.length === 0) {
      return {
        step: '2. Tables exist',
        success: true,
        details: { tables: tableNames }
      };
    } else {
      return {
        step: '2. Tables exist',
        success: false,
        error: `Missing tables: ${missingTables.join(', ')}`
      };
    }
  } catch (error: any) {
    return {
      step: '2. Tables exist',
      success: false,
      error: error.message
    };
  }
}

async function verifySongCount(): Promise<VerificationResult> {
  try {
    const count = await prisma.song.count();
    const withEmbeddings = await prisma.song.count({
      where: { embedding: { not: null } }
    });

    return {
      step: '3. Song count',
      success: count > 0,
      details: {
        totalSongs: count,
        songsWithEmbeddings: withEmbeddings,
        embeddingCoverage: count > 0 ? ((withEmbeddings / count) * 100).toFixed(1) + '%' : '0%'
      }
    };
  } catch (error: any) {
    return {
      step: '3. Song count',
      success: false,
      error: error.message
    };
  }
}

function vectorNorm(embedding: number[]): number {
  return Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
}

async function verifySampleEmbeddings(): Promise<VerificationResult> {
  try {
    const songs = await prisma.song.findMany({
      where: { embedding: { not: null } },
      take: 3,
      select: {
        id: true,
        title: true,
        artist: true,
        embedding: true
      }
    });

    if (songs.length === 0) {
      return {
        step: '4. Sample embeddings',
        success: false,
        error: 'No songs with embeddings found'
      };
    }

    const samples = songs.map(song => {
      const embedding = song.embedding as number[];
      const norm = vectorNorm(embedding);
      return {
        title: song.title,
        artist: song.artist,
        embeddingDimension: embedding.length,
        norm: norm.toFixed(6),
        nonZero: norm > 0
      };
    });

    const allNonZero = samples.every(s => s.nonZero);

    return {
      step: '4. Sample embeddings (verify non-zero norm)',
      success: allNonZero,
      details: { samples }
    };
  } catch (error: any) {
    return {
      step: '4. Sample embeddings',
      success: false,
      error: error.message
    };
  }
}

async function verifySimilarityQuery(): Promise<VerificationResult> {
  try {
    // Use OpenAI for embeddings (simpler for verification)
    if (!process.env.OPENAI_API_KEY) {
      return {
        step: '5. Similarity query',
        success: false,
        error: 'OPENAI_API_KEY not set - skipping similarity test'
      };
    }

    const OpenAI = (await import('openai')).default;
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // Test query
    const testQuery = "feeling happy and energetic";

    // Generate embedding
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: testQuery,
      encoding_format: 'float'
    });

    const queryEmbedding = response.data[0].embedding;
    const embeddingString = `[${queryEmbedding.join(',')}]`;
    const topK = 5;

    const results = await prisma.$queryRaw<Array<{
      id: string;
      title: string;
      artist: string;
      year: number | null;
      similarity: number;
    }>>`
      SELECT
        id,
        title,
        artist,
        year,
        (embedding::jsonb::text::vector <=> ${embeddingString}::vector) * -1 + 1 as similarity
      FROM songs
      WHERE embedding IS NOT NULL
      ORDER BY embedding::jsonb::text::vector <=> ${embeddingString}::vector
      LIMIT ${topK}
    `;

    if (results.length > 0) {
      return {
        step: '5. Similarity query (topK songs)',
        success: true,
        details: {
          query: testQuery,
          topK: topK,
          results: results.map(r => ({
            title: r.title,
            artist: r.artist,
            year: r.year,
            similarity: r.similarity.toFixed(4)
          }))
        }
      };
    } else {
      return {
        step: '5. Similarity query',
        success: false,
        error: 'No results returned from similarity search'
      };
    }
  } catch (error: any) {
    return {
      step: '5. Similarity query',
      success: false,
      error: error.message
    };
  }
}

async function runVerification() {
  try {
    logger.info('🔍 Starting Phase 1 Verification...\n');

    await prisma.$connect();
    logger.info('✅ Database connected\n');

    // Run all verification steps
    results.push(await verifyPgvectorExtension());
    results.push(await verifyTables());
    results.push(await verifySongCount());
    results.push(await verifySampleEmbeddings());
    results.push(await verifySimilarityQuery());

    // Print results
    logger.info('\n' + '='.repeat(80));
    logger.info('PHASE 1 VERIFICATION RESULTS');
    logger.info('='.repeat(80) + '\n');

    results.forEach(result => {
      const status = result.success ? '✅ PASS' : '❌ FAIL';
      logger.info(`${status} | ${result.step}`);

      if (result.details) {
        logger.info('   Details:', JSON.stringify(result.details, null, 2));
      }

      if (result.error) {
        logger.error(`   Error: ${result.error}`);
      }

      logger.info('');
    });

    const passedCount = results.filter(r => r.success).length;
    const totalCount = results.length;

    logger.info('='.repeat(80));
    logger.info(`SUMMARY: ${passedCount}/${totalCount} checks passed`);
    logger.info('='.repeat(80));

    if (passedCount === totalCount) {
      logger.info('\n🎉 Phase 1 verification PASSED! Database is ready for relaunch.\n');
      process.exit(0);
    } else {
      logger.error('\n❌ Phase 1 verification FAILED. Please fix the issues above.\n');
      process.exit(1);
    }

  } catch (error) {
    logger.error({ error }, '❌ Verification failed with unhandled error');
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Received SIGINT, shutting down...');
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, shutting down...');
  await prisma.$disconnect();
  process.exit(0);
});

runVerification();
