/**
 * Semantic KNN Searcher
 * 
 * Performs embedding-based K-nearest neighbor search using cosine similarity
 * against Song.embedding vectors.
 */

import { PrismaClient } from '@prisma/client';
import { logger } from '../../config/index.js';
import { getEmbeddingService } from '../../embeddings/index.js';

export interface SemanticMatch {
  songId: string;
  title: string;
  artist: string;
  similarity: number;
  distance: number;
  tags: string[];
  year?: number;
  decade?: number;
  popularity: number;
}

/** Result from union+rerank when ABOUTNESS_ENABLED=true (V1 legacy) */
export interface AboutnessMatch extends SemanticMatch {
  distMeta?: number;
  distAbout?: number;
  aboutScore: number;
  aboutnessJson?: any;
}

/** Result from 3-signal union+rerank when ABOUTNESS_V2_ENABLED=true */
export interface AboutnessV2Match extends SemanticMatch {
  distMeta?: number;
  distEmotion?: number;
  distMoment?: number;
  aboutScore: number;
  emotionsText?: string;
  momentsText?: string;
  emotionsConfidence?: string;
  momentsConfidence?: string;
}

export interface SemanticConfig {
  knn_size: number;
  embedding_model?: string;
  similarity_threshold?: number; // Minimum similarity to include
  use_reranking?: boolean;       // Re-rank by multiple factors
}

type RawSimilarityResult = {
  id: string;
  title: string;
  artist: string;
  tags: string[];
  year: number | null;
  popularity: number;
  similarity: number;
};

export class SemanticSearcher {
  private prisma: PrismaClient;
  private config: SemanticConfig;

  constructor(prisma: PrismaClient, config: SemanticConfig) {
    this.prisma = prisma;
    this.config = {
      similarity_threshold: 0.5,
      use_reranking: true,
      ...config
    };
  }

  /**
   * Find semantically similar songs using embedding search
   */
  async findSimilar(message: string, k: number = 50): Promise<SemanticMatch[]> {
    const startTime = Date.now();

    try {
      // Generate embedding for the input message
      logger.debug({ message: message.substring(0, 100) }, 'Generating message embedding');
      const embeddingService = await getEmbeddingService();
      const messageEmbedding = await embeddingService.embedSingle(message);

      // CRITICAL: Validate embedding dimensions immediately
      const expectedDims = 384;
      if (messageEmbedding.length !== expectedDims) {
        const error = new Error(`Embedding dimension mismatch: got ${messageEmbedding.length}, expected ${expectedDims}`);
        logger.error({
          got: messageEmbedding.length,
          expected: expectedDims,
          message: message.substring(0, 100)
        }, 'FATAL: Embedding dimension mismatch');
        throw error;
      }

      // Debug logging if DEBUG_MATCHING is enabled
      if (process.env.DEBUG_MATCHING === '1') {
        const norm = Math.sqrt(messageEmbedding.reduce((sum, val) => sum + val * val, 0));
        const sumAbs = messageEmbedding.reduce((sum, val) => sum + Math.abs(val), 0);
        const isZero = messageEmbedding.every(val => val === 0);

        // Log database connection info (redact password)
        const dbUrl = process.env.DATABASE_URL || 'NOT_SET';
        const dbUrlRedacted = dbUrl.replace(/:\/\/([^:]+):([^@]+)@/, '://$1:***@');

        logger.info({
          database: {
            url: dbUrlRedacted,
            schema: 'public' // explicit schema we're querying
          },
          receivedMessage: {
            length: message.length,
            preview: message.substring(0, 80)
          },
          embeddingInput: {
            length: message.length,
            preview: message.substring(0, 80)
          },
          embedding: {
            dimensions: messageEmbedding.length,
            expectedDimensions: expectedDims,
            first5: messageEmbedding.slice(0, 5),
            l2Norm: norm.toFixed(6),
            sumAbs: sumAbs.toFixed(6),
            isAllZeros: isZero
          },
          queryPath: 'native_vector'
        }, '[DEBUG_MATCHING] Embedding generated');
      }

      // DIAGNOSTIC: Check how many eligible songs exist BEFORE running KNN query
      const eligibleCount = await this.prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*) as count
        FROM songs
        WHERE embedding_vector IS NOT NULL
          AND is_placeholder = false
      `;
      const eligibleSongsCount = Number(eligibleCount[0]?.count || 0);

      if (process.env.DEBUG_MATCHING === '1') {
        logger.info({
          eligibleSongsCount,
          message: message.substring(0, 80)
        }, '[DEBUG_MATCHING] Eligible songs count before KNN query');
      }

      if (eligibleSongsCount === 0) {
        logger.warn('No eligible songs in database (embedding_vector IS NOT NULL AND is_placeholder = false)');
        return [];
      }

      // Use raw SQL to query songs with embeddings and calculate cosine similarity
      logger.debug('Performing vector similarity search');

      const limit = k * 2;

      // Set HNSW ef_search parameter for sufficient candidate examination
      await this.prisma.$executeRawUnsafe(`SET LOCAL hnsw.ef_search = ${Math.max(limit, 100)}`);

      // Use native vector column for fast HNSW index search
      // Build vector literal - use $queryRawUnsafe to avoid Prisma escaping issues
      const embeddingString = `[${messageEmbedding.join(',')}]`;

      if (process.env.DEBUG_MATCHING === '1') {
        logger.info({
          message: message.substring(0, 80),
          embeddingString: embeddingString.substring(0, 200) + '...',
          embeddingStringLength: embeddingString.length,
          limit,
          approach: 'Using $queryRawUnsafe to avoid parameter escaping issues'
        }, '[DEBUG_MATCHING] About to execute KNN query');
      }

      let results: Array<{
        id: string;
        title: string;
        artist: string;
        tags: string[];
        year: number | null;
        popularity: number;
        similarity: number;
      }> = [];

      try {
        // CRITICAL FIX: Use temp table to materialize the query vector
        // CTEs and direct embedding in ORDER BY return 0 rows due to PostgreSQL/pgvector query planner issue
        // Temp tables force materialization and fix the problem

        // Create temp table if it doesn't exist (session-scoped, safe for concurrent queries)
        await this.prisma.$executeRawUnsafe(`
          CREATE TEMP TABLE IF NOT EXISTS query_vec_temp (vec vector(384))
        `);

        // Clear and insert query vector
        await this.prisma.$executeRawUnsafe(`DELETE FROM query_vec_temp`);
        await this.prisma.$executeRawUnsafe(`
          INSERT INTO query_vec_temp (vec) VALUES ('${embeddingString}'::vector(384))
        `);

        // Query using temp table
        results = await this.prisma.$queryRawUnsafe<Array<{
          id: string;
          title: string;
          artist: string;
          tags: string[];
          year: number | null;
          popularity: number;
          similarity: number;
        }>>(`
          SELECT
            s.id,
            s.title,
            s.artist,
            s.tags,
            s.year,
            s.popularity,
            (s.embedding_vector <=> q.vec) * -1 + 1 as similarity
          FROM public.songs s
          CROSS JOIN query_vec_temp q
          WHERE s.embedding_vector IS NOT NULL
            AND s.is_placeholder = false
          ORDER BY s.embedding_vector <=> q.vec
          LIMIT ${limit}
        `);

        if (process.env.DEBUG_MATCHING === '1') {
          logger.info({
            message: message.substring(0, 80),
            resultsCount: results.length,
            firstResult: results[0] ? {
              title: results[0].title,
              artist: results[0].artist,
              similarity: results[0].similarity
            } : null
          }, '[DEBUG_MATCHING] KNN query executed successfully');
        }
      } catch (queryError: any) {
        logger.error({
          error: queryError.message,
          stack: queryError.stack,
          message: message.substring(0, 100),
          embeddingDims: messageEmbedding.length,
          limit,
          eligibleSongsCount
        }, 'KNN query FAILED - this should not happen');
        throw queryError;
      }

      // This should NEVER happen if eligibleSongsCount > 0
      if (results.length === 0) {
        logger.error({
          message: message.substring(0, 100),
          embeddingDims: messageEmbedding.length,
          eligibleSongsCount,
          limit
        }, 'KNN_QUERY_RETURNED_ZERO_UNEXPECTED: eligible songs exist but query returned 0 rows');
        return [];
      }

      logger.debug({ songCount: results.length }, 'Computing similarities complete');

      // Debug logging if DEBUG_MATCHING is enabled
      if (process.env.DEBUG_MATCHING === '1') {
        logger.info({
          resultCount: results.length,
          top3Results: results.slice(0, 3).map(r => ({
            title: r.title,
            artist: r.artist,
            similarity: r.similarity.toFixed(4)
          })),
          sqlQuery: {
            usedNativeVector: true,
            embeddingDims: messageEmbedding.length,
            limit: k * 2
          }
        }, '[DEBUG_MATCHING] Query results');
      }

      // Convert results to SemanticMatch format
      const threshold = this.config.similarity_threshold ?? 0.2;
      const allMatches = results.map((result: RawSimilarityResult) => ({
        songId: result.id,
        title: result.title,
        artist: result.artist,
        similarity: result.similarity,
        distance: 1 - result.similarity,
        tags: result.tags || [],
        year: result.year || undefined,
        decade: result.year ? Math.floor(result.year / 10) * 10 : undefined,
        popularity: result.popularity
      }));

      // Filter by threshold and log what was filtered
      const matches = allMatches.filter((result) => {
        const passesThreshold = result.similarity >= threshold;
        if (!passesThreshold && process.env.DEBUG_MATCHING === '1') {
          logger.debug({
            title: result.title,
            artist: result.artist,
            similarity: result.similarity,
            threshold
          }, '[DEBUG_MATCHING] Filtered out by threshold');
        }
        return passesThreshold;
      }).slice(0, k);

      const duration = Date.now() - startTime;
      logger.debug({
        totalResults: results.length,
        filteredMatches: matches.length,
        topSimilarity: matches[0]?.similarity || 0,
        threshold,
        duration
      }, 'Semantic search completed');

      return matches;

    } catch (error) {
      logger.error({ error, message }, 'Semantic search failed');
      throw error;
    }
  }

  /**
   * Find similar songs with additional filtering and boosting
   */
  async findSimilarWithContext(
    message: string,
    context: {
      preferredTags?: string[];
      excludedSongs?: string[];
      yearRange?: { min: number; max: number };
      minPopularity?: number;
    },
    k: number = 50
  ): Promise<SemanticMatch[]> {
    // First get the base semantic matches
    const baseMatches = await this.findSimilar(message, k * 2); // Get more initially

    // Apply context-based filtering and boosting
    let contextualMatches = baseMatches;

    // Filter by excluded songs
    if (context.excludedSongs?.length) {
      contextualMatches = contextualMatches.filter(match => 
        !context.excludedSongs!.includes(match.songId)
      );
    }

    // Filter by year range
    if (context.yearRange && context.yearRange.min && context.yearRange.max) {
      contextualMatches = contextualMatches.filter(match => 
        match.year && 
        match.year >= context.yearRange!.min && 
        match.year <= context.yearRange!.max
      );
    }

    // Filter by minimum popularity
    if (context.minPopularity) {
      contextualMatches = contextualMatches.filter(match => 
        match.popularity >= context.minPopularity!
      );
    }

    // Boost songs with preferred tags
    if (context.preferredTags?.length) {
      contextualMatches = contextualMatches.map(match => {
        const tagOverlap = match.tags.filter(tag => 
          context.preferredTags!.includes(tag.toLowerCase())
        ).length;
        
        if (tagOverlap > 0) {
          // Boost similarity by 10% per matching tag (max 50% boost)
          const boost = Math.min(tagOverlap * 0.1, 0.5);
          return {
            ...match,
            similarity: Math.min(1.0, match.similarity * (1 + boost))
          };
        }
        
        return match;
      });

      // Re-sort after boosting
      contextualMatches.sort((a, b) => b.similarity - a.similarity);
    }

    return contextualMatches.slice(0, k);
  }

  /**
   * Get embedding statistics for debugging
   */
  async getEmbeddingStats(): Promise<{
    totalSongs: number;
    songsWithEmbeddings: number;
    averageEmbeddingDimensions: number;
    embeddingCoverage: number;
  }> {
    const totalSongs = await this.prisma.song.count();

    // Use raw SQL to count songs with vector embeddings (vector-only, NOT JSONB)
    const embeddingStats = await this.prisma.$queryRaw<Array<{
      count: bigint;
      dimensions: number;
    }>>`
      SELECT
        COUNT(*) as count,
        vector_dims(embedding_vector) as dimensions
      FROM songs
      WHERE embedding_vector IS NOT NULL
      LIMIT 1
    `;

    const songsWithEmbeddings = Number(embeddingStats[0]?.count || 0);
    const dimensions = embeddingStats[0]?.dimensions || 0;

    return {
      totalSongs,
      songsWithEmbeddings,
      averageEmbeddingDimensions: dimensions,
      embeddingCoverage: totalSongs > 0 ? songsWithEmbeddings / totalSongs : 0
    };
  }

  /**
   * Health check for semantic search
   */
  async isHealthy(): Promise<boolean> {
    try {
      // Check if embedding service is available
      const embeddingService = await getEmbeddingService();
      const isEmbeddingHealthy = await embeddingService.getStatus();
      
      // Check if we have songs with embeddings
      const stats = await this.getEmbeddingStats();
      
      return isEmbeddingHealthy.primary.available && stats.songsWithEmbeddings > 0;
    } catch (error) {
      logger.warn({ error }, 'Semantic search health check failed');
      return false;
    }
  }

  /**
   * Batch similarity search for multiple queries
   */
  async batchFindSimilar(
    messages: string[],
    k: number = 50
  ): Promise<SemanticMatch[][]> {
    const results: SemanticMatch[][] = [];

    for (const message of messages) {
      const matches = await this.findSimilar(message, k);
      results.push(matches);
    }

    return results;
  }

  /**
   * Union + rerank: query both meta embedding and aboutness embedding,
   * combine candidates, score by weighted combination, return top K.
   *
   * Falls back gracefully if the aboutness query fails (returns meta-only).
   * Requires ABOUTNESS_ENABLED env flag to be checked by caller.
   */
  async findSimilarUnionRerank(
    message: string,
    k: number = 10,
    opts: { topN: number; metaWeight: number; aboutnessWeight: number }
  ): Promise<AboutnessMatch[]> {
    const startTime = Date.now();
    const { topN, metaWeight, aboutnessWeight } = opts;

    // 1. Embed message (same model as runtime)
    const embeddingService = await getEmbeddingService();
    const messageEmbedding = await embeddingService.embedSingle(message);

    const expectedDims = 384;
    if (messageEmbedding.length !== expectedDims) {
      throw new Error(
        `Embedding dimension mismatch: got ${messageEmbedding.length}, expected ${expectedDims}`
      );
    }

    const embeddingString = `[${messageEmbedding.join(',')}]`;
    const limit = topN;

    // 2. Materialise query vector in temp table (avoids pg planner issue)
    await this.prisma.$executeRawUnsafe(`
      CREATE TEMP TABLE IF NOT EXISTS query_vec_temp (vec vector(384))
    `);
    await this.prisma.$executeRawUnsafe(`DELETE FROM query_vec_temp`);
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO query_vec_temp (vec) VALUES ('${embeddingString}'::vector(384))`
    );

    // Set HNSW ef_search for both legs
    await this.prisma.$executeRawUnsafe(
      `SET LOCAL hnsw.ef_search = ${Math.max(limit * 2, 100)}`
    );

    // 3. Meta leg: songs.embedding_vector
    type MetaRow = { id: string; title: string; artist: string; tags: string[]; year: number | null; popularity: number; dist_meta: number };
    let metaRows: MetaRow[] = [];
    try {
      metaRows = await this.prisma.$queryRawUnsafe<MetaRow[]>(`
        SELECT
          s.id,
          s.title,
          s.artist,
          s.tags,
          s.year,
          s.popularity,
          (s.embedding_vector <=> q.vec) AS dist_meta
        FROM public.songs s
        CROSS JOIN query_vec_temp q
        WHERE s.embedding_vector IS NOT NULL
          AND s.is_placeholder = false
        ORDER BY s.embedding_vector <=> q.vec
        LIMIT ${limit}
      `);
    } catch (err: any) {
      logger.error({ error: err.message }, 'Aboutness: meta leg failed');
    }

    // 4. Aboutness leg: song_aboutness.aboutness_vector
    type AboutRow = { song_id: string; dist_about: number; aboutness_json: any };
    let aboutRows: AboutRow[] = [];
    try {
      aboutRows = await this.prisma.$queryRawUnsafe<AboutRow[]>(`
        SELECT
          sa.song_id,
          (sa.aboutness_vector <=> q.vec) AS dist_about,
          sa.aboutness_json
        FROM song_aboutness sa
        CROSS JOIN query_vec_temp q
        WHERE sa.aboutness_vector IS NOT NULL
        ORDER BY sa.aboutness_vector <=> q.vec
        LIMIT ${limit}
      `);
    } catch (err: any) {
      logger.warn({ error: err.message }, 'Aboutness: aboutness leg failed — falling back to meta-only');
    }

    // 5. Build candidate maps
    const metaMap = new Map<string, MetaRow>();
    for (const r of metaRows) metaMap.set(r.id, r);

    const aboutMap = new Map<string, AboutRow>();
    for (const r of aboutRows) aboutMap.set(r.song_id, r);

    // Union of candidate songIds
    const allIds = new Set<string>([
      ...metaRows.map(r => r.id),
      ...aboutRows.map(r => r.song_id),
    ]);

    // 6. Rerank
    const candidates: AboutnessMatch[] = [];
    for (const songId of allIds) {
      const meta = metaMap.get(songId);
      const about = aboutMap.get(songId);

      const distMeta = meta?.dist_meta;
      const distAbout = about?.dist_about;
      const simMeta = distMeta !== undefined ? 1 - distMeta : 0;
      const simAbout = distAbout !== undefined ? 1 - distAbout : 0;
      const aboutScore = metaWeight * simMeta + aboutnessWeight * simAbout;

      // Need at least one leg to have the song's base info
      if (!meta && !about) continue;

      // Fetch base song info from meta leg if available; aboutness leg only has song_id
      const base = meta ?? {
        id: songId,
        title: '',
        artist: '',
        tags: [],
        year: null,
        popularity: 0,
        dist_meta: undefined,
      };

      candidates.push({
        songId,
        title: base.title,
        artist: base.artist,
        similarity: aboutScore,
        distance: 1 - aboutScore,
        tags: base.tags || [],
        year: base.year ?? undefined,
        decade: base.year ? Math.floor(base.year / 10) * 10 : undefined,
        popularity: base.popularity,
        distMeta,
        distAbout,
        aboutScore,
        aboutnessJson: about?.aboutness_json ?? undefined,
      });
    }

    // Sort by combined score descending
    candidates.sort((a, b) => b.aboutScore - a.aboutScore);
    const topK = candidates.slice(0, k * 2); // over-fetch; caller will re-filter

    const duration = Date.now() - startTime;
    logger.debug({
      metaCandidates: metaRows.length,
      aboutCandidates: aboutRows.length,
      unionSize: allIds.size,
      topK: topK.length,
      duration,
    }, 'Aboutness union+rerank completed');

    return topK;
  }

  /**
   * V2 three-signal union+rerank:
   *   (A) songs.embedding_vector        — metadata (indexed)
   *   (B) song_aboutness.emotions_vector — emotional character (indexed)
   *   (C) song_aboutness.moments_vector  — scene/moment fit (NOT indexed; reranked on candidate set)
   *
   * Fallback behaviour:
   *   - If emotions leg fails → returns meta-only ranked result
   *   - If moments data missing for a candidate → moment sim = 0 (still eligible)
   *   - If this whole method throws → caller falls back to meta-only path
   */
  async findSimilarUnionRerankV2(
    message: string,
    k: number = 10,
    opts: {
      topNMeta: number;
      topNEmotion: number;
      metaWeight: number;
      emotionWeight: number;
      momentWeight: number;
    }
  ): Promise<AboutnessV2Match[]> {
    const startTime = Date.now();
    const { topNMeta, topNEmotion, metaWeight, emotionWeight, momentWeight } = opts;

    // 1. Embed message
    const embeddingService = await getEmbeddingService();
    const messageEmbedding = await embeddingService.embedSingle(message);

    if (messageEmbedding.length !== 384) {
      throw new Error(
        `Embedding dimension mismatch: got ${messageEmbedding.length}, expected 384`
      );
    }

    const embeddingString = `[${messageEmbedding.join(',')}]`;

    // 2. Materialise query vector (avoids pg planner 0-row bug)
    await this.prisma.$executeRawUnsafe(`
      CREATE TEMP TABLE IF NOT EXISTS query_vec_temp (vec vector(384))
    `);
    await this.prisma.$executeRawUnsafe(`DELETE FROM query_vec_temp`);
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO query_vec_temp (vec) VALUES ('${embeddingString}'::vector(384))`
    );

    const efSearch = Math.max(Math.max(topNMeta, topNEmotion) * 2, 100);
    await this.prisma.$executeRawUnsafe(`SET LOCAL hnsw.ef_search = ${efSearch}`);

    // 3. Meta leg
    type MetaRow = {
      id: string; title: string; artist: string;
      tags: string[]; year: number | null; popularity: number;
      dist_meta: number;
    };
    let metaRows: MetaRow[] = [];
    try {
      metaRows = await this.prisma.$queryRawUnsafe<MetaRow[]>(`
        SELECT s.id, s.title, s.artist, s.tags, s.year, s.popularity,
               (s.embedding_vector <=> q.vec) AS dist_meta
        FROM public.songs s
        CROSS JOIN query_vec_temp q
        WHERE s.embedding_vector IS NOT NULL AND s.is_placeholder = false
        ORDER BY s.embedding_vector <=> q.vec
        LIMIT ${topNMeta}
      `);
    } catch (err: any) {
      logger.error({ error: err.message }, 'V2 aboutness: meta leg failed');
    }

    // 4. Emotions leg (indexed HNSW)
    type EmotionRow = {
      song_id: string; dist_emotion: number;
      emotions_text: string | null; emotions_confidence: string | null;
      moments_text: string | null; moments_confidence: string | null;
      moments_vector_hex: string | null;
    };
    let emotionRows: EmotionRow[] = [];
    try {
      emotionRows = await this.prisma.$queryRawUnsafe<EmotionRow[]>(`
        SELECT
          sa.song_id,
          (sa.emotions_vector <=> q.vec) AS dist_emotion,
          sa.emotions_text,
          sa.emotions_confidence,
          sa.moments_text,
          sa.moments_confidence,
          sa.moments_vector::text AS moments_vector_hex
        FROM song_aboutness sa
        CROSS JOIN query_vec_temp q
        WHERE sa.emotions_vector IS NOT NULL
        ORDER BY sa.emotions_vector <=> q.vec
        LIMIT ${topNEmotion}
      `);
    } catch (err: any) {
      logger.warn({ error: err.message }, 'V2 aboutness: emotions leg failed — meta-only fallback');
    }

    // 5. Build candidate union
    const metaMap = new Map<string, MetaRow>();
    for (const r of metaRows) metaMap.set(r.id, r);

    const emotionMap = new Map<string, EmotionRow>();
    for (const r of emotionRows) emotionMap.set(r.song_id, r);

    const allIds = new Set<string>([
      ...metaRows.map(r => r.id),
      ...emotionRows.map(r => r.song_id),
    ]);

    // 6. Compute moments similarity for candidate set
    // moments_vector is stored but not indexed — we compute cosine sim on the small candidate set
    // by fetching the stored vectors and computing dot product in JS (after cosine normalisation)
    // This avoids a full-table sequential scan.
    const candidateIdList = [...allIds];
    type MomentRow = { song_id: string; dist_moment: number };
    let momentMap = new Map<string, number>();

    if (candidateIdList.length > 0 && emotionRows.some(r => r.moments_vector_hex)) {
      try {
        // Use pgvector distance on the candidate set only — no index needed for small set
        const idLiteral = candidateIdList.map(id => `'${id}'::uuid`).join(',');
        const momentRows = await this.prisma.$queryRawUnsafe<MomentRow[]>(`
          SELECT sa.song_id, (sa.moments_vector <=> q.vec) AS dist_moment
          FROM song_aboutness sa
          CROSS JOIN query_vec_temp q
          WHERE sa.song_id IN (${idLiteral})
            AND sa.moments_vector IS NOT NULL
        `);
        for (const r of momentRows) momentMap.set(r.song_id, r.dist_moment);
      } catch (err: any) {
        logger.warn({ error: err.message }, 'V2 aboutness: moments similarity failed — using 0');
      }
    }

    // 7. Rerank
    const candidates: AboutnessV2Match[] = [];
    for (const songId of allIds) {
      const meta = metaMap.get(songId);
      const emo = emotionMap.get(songId);

      const distMeta = meta?.dist_meta;
      const distEmotion = emo?.dist_emotion;
      const distMoment = momentMap.get(songId);

      const simMeta = distMeta !== undefined ? 1 - distMeta : 0;
      const simEmotion = distEmotion !== undefined ? 1 - distEmotion : 0;
      const simMoment = distMoment !== undefined ? 1 - distMoment : 0;

      const aboutScore =
        metaWeight * simMeta + emotionWeight * simEmotion + momentWeight * simMoment;

      const base = meta ?? { id: songId, title: '', artist: '', tags: [], year: null, popularity: 0, dist_meta: undefined };

      candidates.push({
        songId,
        title: base.title,
        artist: base.artist,
        similarity: aboutScore,
        distance: 1 - aboutScore,
        tags: base.tags || [],
        year: base.year ?? undefined,
        decade: base.year ? Math.floor(base.year / 10) * 10 : undefined,
        popularity: base.popularity,
        distMeta,
        distEmotion,
        distMoment,
        aboutScore,
        emotionsText: emo?.emotions_text ?? undefined,
        momentsText: emo?.moments_text ?? undefined,
        emotionsConfidence: emo?.emotions_confidence ?? undefined,
        momentsConfidence: emo?.moments_confidence ?? undefined,
      });
    }

    candidates.sort((a, b) => b.aboutScore - a.aboutScore);
    const topK = candidates.slice(0, k * 2);

    logger.debug({
      metaCandidates: metaRows.length,
      emotionCandidates: emotionRows.length,
      momentCandidates: momentMap.size,
      unionSize: allIds.size,
      topK: topK.length,
      duration: Date.now() - startTime,
    }, 'V2 aboutness union+rerank completed');

    return topK;
  }
}