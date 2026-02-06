import 'dotenv/config';
import { getEmbeddingService } from '../src/embeddings/index.js';
import { logger } from '../src/config/index.js';

/**
 * Check for NaN, Inf, or other problematic values in embeddings
 */
async function checkEmbeddingValues() {
  logger.info('Initializing embedding service...');
  await getEmbeddingService({
    primaryProvider: 'local',
    fallbackProvider: 'openai',
    local: {
      model: 'Xenova/all-MiniLM-L6-v2',
      dimensions: 384
    },
    openai: process.env.OPENAI_API_KEY ? {
      apiKey: process.env.OPENAI_API_KEY,
      model: 'text-embedding-3-small',
      dimensions: 384
    } : undefined
  });

  const embeddingService = await getEmbeddingService();

  const testInputs = ['pizza night', 'home'];

  for (const input of testInputs) {
    logger.info(`\n${'='.repeat(80)}`);
    logger.info(`Analyzing: "${input}"`);
    logger.info('='.repeat(80));

    const embedding = await embeddingService.embedSingle(input);

    // Check for problematic values
    const hasNaN = embedding.some(v => isNaN(v));
    const hasInfinity = embedding.some(v => !isFinite(v));
    const hasNull = embedding.some(v => v === null);
    const hasUndefined = embedding.some(v => v === undefined);

    // Statistical analysis
    const min = Math.min(...embedding);
    const max = Math.max(...embedding);
    const sum = embedding.reduce((a, b) => a + b, 0);
    const mean = sum / embedding.length;
    const variance = embedding.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / embedding.length;
    const stdDev = Math.sqrt(variance);
    const l2Norm = Math.sqrt(embedding.reduce((a, b) => a + b * b, 0));

    // Count extreme values
    const veryLargeValues = embedding.filter(v => Math.abs(v) > 10).length;
    const verySmallValues = embedding.filter(v => Math.abs(v) < 0.0001 && v !== 0).length;
    const zeros = embedding.filter(v => v === 0).length;

    logger.info({
      input,
      dimensions: embedding.length,
      validation: {
        hasNaN,
        hasInfinity,
        hasNull,
        hasUndefined
      },
      statistics: {
        min: min.toFixed(6),
        max: max.toFixed(6),
        mean: mean.toFixed(6),
        stdDev: stdDev.toFixed(6),
        l2Norm: l2Norm.toFixed(6)
      },
      counts: {
        zeros,
        verySmallValues,
        veryLargeValues
      },
      sample: {
        first10: embedding.slice(0, 10).map(v => v.toFixed(6)),
        last10: embedding.slice(-10).map(v => v.toFixed(6))
      }
    }, 'Embedding analysis');

    // Try to identify the specific problematic values
    if (hasNaN || hasInfinity) {
      const problematicIndices = embedding
        .map((v, i) => ({ v, i }))
        .filter(({ v }) => isNaN(v) || !isFinite(v))
        .map(({ v, i }) => ({ index: i, value: v }));

      logger.error({
        input,
        problematicIndices
      }, 'FOUND PROBLEMATIC VALUES');
    }
  }
}

checkEmbeddingValues().catch((error) => {
  logger.error({ error: error.message, stack: error.stack }, 'Check failed');
  process.exit(1);
});
