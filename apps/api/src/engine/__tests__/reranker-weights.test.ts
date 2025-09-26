import { describe, it, expect, beforeEach } from 'vitest';
import { SongReranker, type ScoringWeights, type RankingCandidate, type RankingContext } from '../rerank.js';

describe('Reranker Weights - Confidence Scoring System', () => {
  let reranker: SongReranker;
  let defaultWeights: ScoringWeights;
  let sampleCandidates: RankingCandidate[];

  beforeEach(() => {
    defaultWeights = {
      semantic_weight: 0.45,
      keyword_weight: 0.30,
      popularity_weight: 0.15,
      clarity_weight: 0.10,
      repetition_penalty: 0.2
    };

    reranker = new SongReranker(defaultWeights);

    sampleCandidates = [
      {
        songId: 'song1',
        title: 'Test Song 1',
        artist: 'Test Artist 1',
        scores: {
          semantic: 0.8,
          keyword: 0.9,
          mood: 0.5,
          entity: 0.3
        },
        matchReasons: ['keyword'],
        tags: ['rock'],
        popularity: 75,
        decade: 2010
      },
      {
        songId: 'song2',
        title: 'Test Song 2',
        artist: 'Test Artist 2',
        scores: {
          semantic: 0.9,
          keyword: 0.6,
          mood: 0.7,
          entity: 0.4
        },
        matchReasons: ['semantic'],
        tags: ['pop'],
        popularity: 60,
        decade: 2000
      }
    ];
  });

  describe('Weight Configuration and Validation', () => {
    it('should initialize with correct default weights', () => {
      const weights = reranker.getWeights();
      
      expect(weights.semantic_weight).toBe(0.45);
      expect(weights.keyword_weight).toBe(0.30);
      expect(weights.popularity_weight).toBe(0.15);
      expect(weights.clarity_weight).toBe(0.10);
      expect(weights.repetition_penalty).toBe(0.2);
    });

    it('should validate that weights sum to reasonable total', () => {
      const weights = reranker.getWeights();
      const totalWeight = weights.semantic_weight + weights.keyword_weight + 
                         weights.popularity_weight + weights.clarity_weight;
      
      expect(totalWeight).toBe(1.0); // Should sum to 1.0 for normalized scoring
    });

    it('should allow weight updates', () => {
      const newWeights = {
        semantic_weight: 0.5,
        keyword_weight: 0.3,
        popularity_weight: 0.1,
        clarity_weight: 0.1
      };
      
      reranker.updateWeights(newWeights);
      const updatedWeights = reranker.getWeights();
      
      expect(updatedWeights.semantic_weight).toBe(0.5);
      expect(updatedWeights.keyword_weight).toBe(0.3);
      expect(updatedWeights.repetition_penalty).toBe(0.2); // Should preserve unchanged weights
    });

    it('should create reranker with custom weights', () => {
      const customWeights: ScoringWeights = {
        semantic_weight: 0.6,
        keyword_weight: 0.2,
        popularity_weight: 0.1,
        clarity_weight: 0.1,
        repetition_penalty: 0.15
      };
      
      const customReranker = new SongReranker(customWeights);
      const weights = customReranker.getWeights();
      
      expect(weights.semantic_weight).toBe(0.6);
      expect(weights.keyword_weight).toBe(0.2);
    });
  });

  describe('Score Calculation and Weighting', () => {
    it('should calculate final scores with proper weighting', async () => {
      const candidates = [{
        songId: 'test1',
        title: 'Perfect Match',
        artist: 'Test Artist',
        scores: {
          semantic: 1.0,
          keyword: 1.0,
          mood: 0.8,
          entity: 0.6
        },
        matchReasons: ['semantic', 'keyword'],
        tags: ['rock'],
        popularity: 100 // Max popularity
      }];

      const ranked = await reranker.rankCandidates(candidates, 'test query');
      const finalScore = ranked[0].scores.final;

      // Expected: 1.0*0.45 + 1.0*0.30 + 1.0*0.15 + 0.5*0.10 = 0.95
      expect(finalScore).toBeCloseTo(0.95, 2);
    });

    it('should handle zero scores correctly', async () => {
      const candidates = [{
        songId: 'test1',
        title: 'No Match',
        artist: 'Test Artist',
        scores: {
          semantic: 0.0,
          keyword: 0.0,
          mood: 0.0,
          entity: 0.0
        },
        matchReasons: [],
        tags: [],
        popularity: 0
      }];

      const ranked = await reranker.rankCandidates(candidates, 'test query');
      const finalScore = ranked[0].scores.final;

      // Expected: 0*0.45 + 0*0.30 + 0*0.15 + 0.5*0.10 = 0.05 (default clarity)
      expect(finalScore).toBeCloseTo(0.05, 2);
    });

    it('should prioritize semantic scores with default weights', async () => {
      const semanticCandidate = {
        songId: 'semantic',
        title: 'Semantic Match',
        artist: 'Artist',
        scores: { semantic: 1.0, keyword: 0.0, mood: 0.0, entity: 0.0 },
        matchReasons: ['semantic'],
        tags: ['rock'],
        popularity: 50
      };

      const keywordCandidate = {
        songId: 'keyword',
        title: 'Keyword Match',
        artist: 'Artist',
        scores: { semantic: 0.0, keyword: 1.0, mood: 0.0, entity: 0.0 },
        matchReasons: ['keyword'],
        tags: ['rock'],
        popularity: 50
      };

      const ranked = await reranker.rankCandidates([semanticCandidate, keywordCandidate], 'test');
      
      // Semantic should rank higher due to higher weight (0.45 vs 0.30)
      expect(ranked[0].songId).toBe('semantic');
      expect(ranked[0].scores.final).toBeGreaterThan(ranked[1].scores.final!);
    });

    it('should normalize popularity scores to 0-1 range', async () => {
      const highPopCandidate = {
        songId: 'popular',
        title: 'Popular Song',
        artist: 'Artist',
        scores: { semantic: 0.5, keyword: 0.5, mood: 0.5, entity: 0.5 },
        matchReasons: ['semantic'],
        tags: ['pop'],
        popularity: 100 // Should normalize to 1.0
      };

      const lowPopCandidate = {
        songId: 'unpopular',
        title: 'Unpopular Song',
        artist: 'Artist',
        scores: { semantic: 0.5, keyword: 0.5, mood: 0.5, entity: 0.5 },
        matchReasons: ['semantic'],
        tags: ['indie'],
        popularity: 10 // Should normalize to 0.1
      };

      const ranked = await reranker.rankCandidates([lowPopCandidate, highPopCandidate], 'test');
      
      // High popularity should rank higher
      expect(ranked[0].songId).toBe('popular');
      expect(ranked[0].scores.popularity).toBe(1.0);
      expect(ranked[1].scores.popularity).toBe(0.1);
    });

    it('should clamp final scores to 0-1 range', async () => {
      const extremeCandidate = {
        songId: 'extreme',
        title: 'Extreme Scores',
        artist: 'Artist',
        scores: { semantic: 2.0, keyword: 3.0, mood: -1.0, entity: 0.0 }, // Invalid scores
        matchReasons: ['semantic'],
        tags: ['experimental'],
        popularity: 200 // Invalid popularity
      };

      const ranked = await reranker.rankCandidates([extremeCandidate], 'test');
      const finalScore = ranked[0].scores.final!;
      
      expect(finalScore).toBeGreaterThanOrEqual(0);
      expect(finalScore).toBeLessThanOrEqual(1);
    });
  });

  describe('Repetition Penalty System', () => {
    it('should apply repetition penalty for recent songs', async () => {
      const context: RankingContext = {
        recentSongs: ['song1'],
        userId: 'user123'
      };

      const ranked = await reranker.rankCandidates(sampleCandidates, 'test query', context);
      
      const penalizedSong = ranked.find(c => c.songId === 'song1')!;
      const unpenalizedSong = ranked.find(c => c.songId === 'song2')!;
      
      expect(penalizedSong.scores.repetition_penalty).toBeGreaterThan(0);
      expect(unpenalizedSong.scores.repetition_penalty).toBe(0);
      expect(penalizedSong.scores.final).toBeLessThan(unpenalizedSong.scores.final!);
    });

    it('should apply decade avoidance penalty', async () => {
      const context: RankingContext = {
        avoidDecades: [2010], // Avoid 2010s
        userId: 'user123'
      };

      const ranked = await reranker.rankCandidates(sampleCandidates, 'test query', context);
      
      const penalizedSong = ranked.find(c => c.decade === 2010)!;
      const unpenalizedSong = ranked.find(c => c.decade === 2000)!;
      
      expect(penalizedSong.scores.repetition_penalty).toBeGreaterThan(0);
      expect(unpenalizedSong.scores.repetition_penalty).toBe(0);
    });

    it('should handle multiple penalties correctly', async () => {
      const context: RankingContext = {
        recentSongs: ['song1'],
        avoidDecades: [2010],
        userId: 'user123'
      };

      // Modify sample to have song1 in avoided decade
      sampleCandidates[0].decade = 2010;

      const ranked = await reranker.rankCandidates(sampleCandidates, 'test query', context);
      
      const multiPenalizedSong = ranked.find(c => c.songId === 'song1')!;
      
      // Should have both recent song penalty and decade penalty
      const expectedPenalty = 0.2 * 0.8 + 0.2 * 0.2; // repetition + decade
      expect(multiPenalizedSong.scores.repetition_penalty).toBeCloseTo(expectedPenalty, 2);
    });

    it('should handle empty context gracefully', async () => {
      const ranked = await reranker.rankCandidates(sampleCandidates, 'test query');
      
      ranked.forEach(candidate => {
        expect(candidate.scores.repetition_penalty).toBe(0);
      });
    });
  });

  describe('Weight Impact Analysis', () => {
    it('should demonstrate semantic weight impact', async () => {
      const highSemanticWeights: ScoringWeights = {
        semantic_weight: 0.8,
        keyword_weight: 0.1,
        popularity_weight: 0.05,
        clarity_weight: 0.05,
        repetition_penalty: 0.2
      };

      const semanticReranker = new SongReranker(highSemanticWeights);
      const defaultRanked = await reranker.rankCandidates(sampleCandidates, 'test');
      const semanticRanked = await semanticReranker.rankCandidates(sampleCandidates, 'test');

      // With higher semantic weight, song2 (higher semantic score) should rank better
      expect(semanticRanked[0].scores.semantic).toBeGreaterThanOrEqual(defaultRanked[0].scores.semantic!);
    });

    it('should demonstrate keyword weight impact', async () => {
      const highKeywordWeights: ScoringWeights = {
        semantic_weight: 0.1,
        keyword_weight: 0.8,
        popularity_weight: 0.05,
        clarity_weight: 0.05,
        repetition_penalty: 0.2
      };

      const keywordReranker = new SongReranker(highKeywordWeights);
      const keywordRanked = await keywordReranker.rankCandidates(sampleCandidates, 'test');

      // With higher keyword weight, song1 (higher keyword score) should rank better
      expect(keywordRanked[0].scores.keyword).toBeGreaterThanOrEqual(keywordRanked[1].scores.keyword);
    });

    it('should demonstrate popularity weight impact', async () => {
      const highPopularityWeights: ScoringWeights = {
        semantic_weight: 0.2,
        keyword_weight: 0.2,
        popularity_weight: 0.5,
        clarity_weight: 0.1,
        repetition_penalty: 0.2
      };

      const popularityReranker = new SongReranker(highPopularityWeights);
      const popularityRanked = await popularityReranker.rankCandidates(sampleCandidates, 'test');

      // With higher popularity weight, song1 (higher popularity) should rank better
      expect(popularityRanked[0].popularity).toBeGreaterThanOrEqual(popularityRanked[1].popularity!);
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle empty candidate list', async () => {
      const ranked = await reranker.rankCandidates([], 'test query');
      expect(ranked).toHaveLength(0);
    });

    it('should handle missing score fields', async () => {
      const incompleteCandidate = {
        songId: 'incomplete',
        title: 'Incomplete Song',
        artist: 'Artist',
        scores: { 
          semantic: 0.0, // Default values for required fields
          keyword: 0.0,
          mood: 0.5, 
          entity: 0.3 
        },
        matchReasons: [],
        tags: []
      };

      const ranked = await reranker.rankCandidates([incompleteCandidate], 'test');
      
      expect(ranked).toHaveLength(1);
      expect(ranked[0].scores.final).toBeGreaterThanOrEqual(0);
      expect(ranked[0].scores.final).toBeLessThanOrEqual(1);
    });

    it('should limit results to top 20 candidates', async () => {
      const manyCandidates = Array(50).fill(null).map((_, i) => ({
        songId: `song${i}`,
        title: `Song ${i}`,
        artist: 'Artist',
        scores: {
          semantic: Math.random(),
          keyword: Math.random(),
          mood: Math.random(),
          entity: Math.random()
        },
        matchReasons: ['semantic'],
        tags: ['test'],
        popularity: Math.random() * 100
      }));

      const ranked = await reranker.rankCandidates(manyCandidates, 'test');
      
      expect(ranked).toHaveLength(20);
      
      // Should be sorted by final score descending
      for (let i = 1; i < ranked.length; i++) {
        expect(ranked[i - 1].scores.final).toBeGreaterThanOrEqual(ranked[i].scores.final!);
      }
    });

    it('should handle invalid weight configurations gracefully', async () => {
      const invalidWeights: ScoringWeights = {
        semantic_weight: -0.1,  // Negative weight
        keyword_weight: 0.3,
        popularity_weight: 0.15,
        clarity_weight: 0.1,
        repetition_penalty: 2.0  // Very high penalty
      };

      const invalidReranker = new SongReranker(invalidWeights);
      const ranked = await invalidReranker.rankCandidates(sampleCandidates, 'test');
      
      // Should still produce valid results
      expect(ranked).toHaveLength(2);
      ranked.forEach(candidate => {
        expect(candidate.scores.final).toBeGreaterThanOrEqual(0);
        expect(candidate.scores.final).toBeLessThanOrEqual(1);
      });
    });
  });

  describe('Performance and Consistency', () => {
    it('should produce consistent rankings for identical inputs', async () => {
      const rankings1 = await reranker.rankCandidates(sampleCandidates, 'test query');
      const rankings2 = await reranker.rankCandidates(sampleCandidates, 'test query');
      
      expect(rankings1).toHaveLength(rankings2.length);
      
      for (let i = 0; i < rankings1.length; i++) {
        expect(rankings1[i].songId).toBe(rankings2[i].songId);
        expect(rankings1[i].scores.final).toBeCloseTo(rankings2[i].scores.final!, 10);
      }
    });

    it('should handle large candidate sets efficiently', async () => {
      const largeCandidateSet = Array(1000).fill(null).map((_, i) => ({
        songId: `song${i}`,
        title: `Song ${i}`,
        artist: `Artist ${i % 10}`,
        scores: {
          semantic: Math.random(),
          keyword: Math.random(),
          mood: Math.random(),
          entity: Math.random()
        },
        matchReasons: ['semantic'],
        tags: ['test'],
        popularity: Math.random() * 100,
        decade: 2000 + (i % 20)
      }));

      const startTime = performance.now();
      const ranked = await reranker.rankCandidates(largeCandidateSet, 'performance test');
      const duration = performance.now() - startTime;

      expect(ranked).toHaveLength(20); // Should return top 20
      expect(duration).toBeLessThan(100); // Should complete quickly (< 100ms)
      
      // Verify ranking quality
      for (let i = 1; i < ranked.length; i++) {
        expect(ranked[i - 1].scores.final).toBeGreaterThanOrEqual(ranked[i].scores.final!);
      }
    });
  });
});