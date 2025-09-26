#!/usr/bin/env node

/**
 * Music Mapping Evaluation Harness
 * 
 * Reads test fixtures from fixtures/eval.jsonl and evaluates the song matching system
 * against expected results. Calculates:
 * 
 * - Top-1 Hit Rate: % of cases where the primary match is in expectedTitleIds
 * - Top-3 Hit Rate: % of cases where any of top 3 matches are in expectedTitleIds
 * - Mean Reciprocal Rank: Average of 1/rank for first correct match (higher = better)
 * - Confusion by Tag: Performance breakdown by song tags/categories
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import { SongMatchingService } from '../src/services/song-matching-service.js';
import { logger } from '../src/config/index.js';

interface EvalFixture {
  text: string;
  expectedTitleIds: string[];
  tags?: string[];
  description?: string;
  difficulty?: 'easy' | 'medium' | 'hard';
}

interface EvalResult {
  fixture: EvalFixture;
  actualTitleId: string;
  actualTitle: string;
  actualArtist: string;
  alternateIds: string[];
  top1Hit: boolean;
  top3Hit: boolean;
  reciprocalRank: number;
  confidence: number;
  strategy: string;
  processingTimeMs: number;
  error?: string;
}

interface EvalSummary {
  totalTests: number;
  top1HitRate: number;
  top3HitRate: number;
  meanReciprocalRank: number;
  averageConfidence: number;
  strategyBreakdown: Record<string, { count: number; hitRate: number }>;
  tagBreakdown: Record<string, { count: number; hitRate: number; mrr: number }>;
  difficultyBreakdown: Record<string, { count: number; hitRate: number; mrr: number }>;
  errorRate: number;
  averageProcessingTime: number;
}

class EvaluationHarness {
  private prisma: PrismaClient;
  private songMatchingService: SongMatchingService;
  private results: EvalResult[] = [];

  constructor() {
    this.prisma = new PrismaClient({
      log: ['error'] // Reduce logging during evaluation
    });
    this.songMatchingService = new SongMatchingService(this.prisma);
  }

  /**
   * Load evaluation fixtures from JSONL file
   */
  async loadFixtures(fixturePath: string): Promise<EvalFixture[]> {
    try {
      const content = await fs.readFile(fixturePath, 'utf-8');
      const lines = content.trim().split('\n').filter(line => line.trim());
      
      const fixtures: EvalFixture[] = [];
      for (const [index, line] of lines.entries()) {
        try {
          const fixture = JSON.parse(line) as EvalFixture;
          
          // Validate fixture format
          if (!fixture.text || !fixture.expectedTitleIds || !Array.isArray(fixture.expectedTitleIds)) {
            throw new Error(`Invalid fixture format at line ${index + 1}`);
          }
          
          fixtures.push(fixture);
        } catch (error) {
          logger.warn({ line, index, error }, 'Failed to parse fixture line');
        }
      }
      
      logger.info({ fixturesLoaded: fixtures.length }, 'Loaded evaluation fixtures');
      return fixtures;
    } catch (error) {
      logger.error({ error, fixturePath }, 'Failed to load evaluation fixtures');
      throw error;
    }
  }

  /**
   * Get song ID by title (for building expected results)
   */
  async getSongIdByTitle(title: string, artist?: string): Promise<string | null> {
    const where: any = {
      title: { contains: title, mode: 'insensitive' }
    };
    
    if (artist) {
      where.artist = { contains: artist, mode: 'insensitive' };
    }
    
    const song = await this.prisma.song.findFirst({ where });
    return song?.id || null;
  }

  /**
   * Run evaluation on a single fixture
   */
  async evaluateFixture(fixture: EvalFixture): Promise<EvalResult> {
    const startTime = Date.now();
    
    try {
      // Run the song matching service
      const matchResult = await this.songMatchingService.matchSongs(
        fixture.text,
        false, // allowExplicit
        undefined, // userId
        false // roomAllowsExplicit
      );

      // Get actual song ID from database
      const actualSong = await this.prisma.song.findFirst({
        where: {
          AND: [
            { title: matchResult.primary.title },
            { artist: matchResult.primary.artist }
          ]
        }
      });

      // Get alternate song IDs
      const alternateIds: string[] = [];
      for (const alternate of matchResult.alternates) {
        const altSong = await this.prisma.song.findFirst({
          where: {
            AND: [
              { title: alternate.title },
              { artist: alternate.artist }
            ]
          }
        });
        if (altSong) {
          alternateIds.push(altSong.id);
        }
      }

      const processingTime = Date.now() - startTime;

      if (!actualSong) {
        return {
          fixture,
          actualTitleId: '',
          actualTitle: matchResult.primary.title,
          actualArtist: matchResult.primary.artist,
          alternateIds,
          top1Hit: false,
          top3Hit: false,
          reciprocalRank: 0,
          confidence: matchResult.scores.confidence,
          strategy: matchResult.scores.strategy,
          processingTimeMs: processingTime,
          error: 'Song not found in database'
        };
      }

      // Calculate hits and reciprocal rank
      const allIds = [actualSong.id, ...alternateIds];
      const top1Hit = fixture.expectedTitleIds.includes(actualSong.id);
      const top3Hit = allIds.some(id => fixture.expectedTitleIds.includes(id));
      
      // Find reciprocal rank (1/position of first correct match)
      let reciprocalRank = 0;
      for (let i = 0; i < allIds.length; i++) {
        if (fixture.expectedTitleIds.includes(allIds[i])) {
          reciprocalRank = 1 / (i + 1);
          break;
        }
      }

      return {
        fixture,
        actualTitleId: actualSong.id,
        actualTitle: matchResult.primary.title,
        actualArtist: matchResult.primary.artist,
        alternateIds,
        top1Hit,
        top3Hit,
        reciprocalRank,
        confidence: matchResult.scores.confidence,
        strategy: matchResult.scores.strategy,
        processingTimeMs: processingTime,
      };

    } catch (error) {
      const processingTime = Date.now() - startTime;
      logger.warn({ error, fixture }, 'Error evaluating fixture');
      
      return {
        fixture,
        actualTitleId: '',
        actualTitle: '',
        actualArtist: '',
        alternateIds: [],
        top1Hit: false,
        top3Hit: false,
        reciprocalRank: 0,
        confidence: 0,
        strategy: 'error',
        processingTimeMs: processingTime,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Run evaluation on all fixtures
   */
  async runEvaluation(fixtures: EvalFixture[]): Promise<void> {
    logger.info({ totalFixtures: fixtures.length }, 'Starting evaluation');
    
    let completed = 0;
    for (const fixture of fixtures) {
      const result = await this.evaluateFixture(fixture);
      this.results.push(result);
      
      completed++;
      if (completed % 10 === 0) {
        logger.info({ completed, total: fixtures.length }, 'Evaluation progress');
      }
    }
    
    logger.info({ completed }, 'Evaluation completed');
  }

  /**
   * Calculate summary statistics
   */
  calculateSummary(): EvalSummary {
    const validResults = this.results.filter(r => !r.error);
    const total = this.results.length;
    
    if (total === 0) {
      throw new Error('No results to analyze');
    }

    // Basic metrics
    const top1Hits = this.results.filter(r => r.top1Hit).length;
    const top3Hits = this.results.filter(r => r.top3Hit).length;
    const totalRR = this.results.reduce((sum, r) => sum + r.reciprocalRank, 0);
    const totalConfidence = validResults.reduce((sum, r) => sum + r.confidence, 0);
    const totalProcessingTime = this.results.reduce((sum, r) => sum + r.processingTimeMs, 0);
    const errors = this.results.filter(r => r.error).length;

    // Strategy breakdown
    const strategyBreakdown: Record<string, { count: number; hitRate: number }> = {};
    for (const result of validResults) {
      if (!strategyBreakdown[result.strategy]) {
        strategyBreakdown[result.strategy] = { count: 0, hitRate: 0 };
      }
      strategyBreakdown[result.strategy].count++;
      if (result.top1Hit) {
        strategyBreakdown[result.strategy].hitRate++;
      }
    }
    
    // Convert hit counts to percentages
    for (const strategy in strategyBreakdown) {
      const stats = strategyBreakdown[strategy];
      stats.hitRate = (stats.hitRate / stats.count) * 100;
    }

    // Tag breakdown
    const tagBreakdown: Record<string, { count: number; hitRate: number; mrr: number }> = {};
    for (const result of validResults) {
      const tags = result.fixture.tags || ['untagged'];
      for (const tag of tags) {
        if (!tagBreakdown[tag]) {
          tagBreakdown[tag] = { count: 0, hitRate: 0, mrr: 0 };
        }
        tagBreakdown[tag].count++;
        if (result.top1Hit) {
          tagBreakdown[tag].hitRate++;
        }
        tagBreakdown[tag].mrr += result.reciprocalRank;
      }
    }
    
    // Convert to percentages and averages
    for (const tag in tagBreakdown) {
      const stats = tagBreakdown[tag];
      stats.hitRate = (stats.hitRate / stats.count) * 100;
      stats.mrr = stats.mrr / stats.count;
    }

    // Difficulty breakdown
    const difficultyBreakdown: Record<string, { count: number; hitRate: number; mrr: number }> = {};
    for (const result of validResults) {
      const difficulty = result.fixture.difficulty || 'unknown';
      if (!difficultyBreakdown[difficulty]) {
        difficultyBreakdown[difficulty] = { count: 0, hitRate: 0, mrr: 0 };
      }
      difficultyBreakdown[difficulty].count++;
      if (result.top1Hit) {
        difficultyBreakdown[difficulty].hitRate++;
      }
      difficultyBreakdown[difficulty].mrr += result.reciprocalRank;
    }
    
    // Convert to percentages and averages
    for (const difficulty in difficultyBreakdown) {
      const stats = difficultyBreakdown[difficulty];
      stats.hitRate = (stats.hitRate / stats.count) * 100;
      stats.mrr = stats.mrr / stats.count;
    }

    return {
      totalTests: total,
      top1HitRate: (top1Hits / total) * 100,
      top3HitRate: (top3Hits / total) * 100,
      meanReciprocalRank: totalRR / total,
      averageConfidence: validResults.length > 0 ? totalConfidence / validResults.length : 0,
      strategyBreakdown,
      tagBreakdown,
      difficultyBreakdown,
      errorRate: (errors / total) * 100,
      averageProcessingTime: totalProcessingTime / total
    };
  }

  /**
   * Print detailed results
   */
  printResults(summary: EvalSummary): void {
    console.log('\n🎵 MUSIC MAPPING EVALUATION RESULTS 🎵\n');
    console.log('=' .repeat(50));
    
    // Overall Performance
    console.log('\n📊 OVERALL PERFORMANCE');
    console.log('-'.repeat(30));
    console.log(`Total Test Cases: ${summary.totalTests}`);
    console.log(`Top-1 Hit Rate: ${summary.top1HitRate.toFixed(1)}%`);
    console.log(`Top-3 Hit Rate: ${summary.top3HitRate.toFixed(1)}%`);
    console.log(`Mean Reciprocal Rank: ${summary.meanReciprocalRank.toFixed(3)}`);
    console.log(`Average Confidence: ${summary.averageConfidence.toFixed(1)}%`);
    console.log(`Error Rate: ${summary.errorRate.toFixed(1)}%`);
    console.log(`Avg Processing Time: ${summary.averageProcessingTime.toFixed(1)}ms`);

    // Strategy Performance
    console.log('\n🎯 STRATEGY BREAKDOWN');
    console.log('-'.repeat(30));
    for (const [strategy, stats] of Object.entries(summary.strategyBreakdown)) {
      console.log(`${strategy.padEnd(15)}: ${stats.count.toString().padStart(3)} tests, ${stats.hitRate.toFixed(1)}% hit rate`);
    }

    // Tag Performance
    if (Object.keys(summary.tagBreakdown).length > 1) {
      console.log('\n🏷️  TAG PERFORMANCE');
      console.log('-'.repeat(40));
      for (const [tag, stats] of Object.entries(summary.tagBreakdown)) {
        console.log(`${tag.padEnd(15)}: ${stats.count.toString().padStart(3)} tests, ${stats.hitRate.toFixed(1)}% hit rate, ${stats.mrr.toFixed(3)} MRR`);
      }
    }

    // Difficulty Performance
    if (Object.keys(summary.difficultyBreakdown).length > 1) {
      console.log('\n⚡ DIFFICULTY BREAKDOWN');
      console.log('-'.repeat(40));
      for (const [difficulty, stats] of Object.entries(summary.difficultyBreakdown)) {
        console.log(`${difficulty.padEnd(15)}: ${stats.count.toString().padStart(3)} tests, ${stats.hitRate.toFixed(1)}% hit rate, ${stats.mrr.toFixed(3)} MRR`);
      }
    }

    // Failure Analysis
    const failures = this.results.filter(r => !r.top1Hit && !r.error);
    if (failures.length > 0) {
      console.log('\n❌ FAILURE ANALYSIS (Top 10)');
      console.log('-'.repeat(60));
      failures
        .sort((a, b) => b.confidence - a.confidence) // Show high-confidence failures first
        .slice(0, 10)
        .forEach(failure => {
          console.log(`Input: "${failure.fixture.text}"`);
          console.log(`Expected: [${failure.fixture.expectedTitleIds.join(', ')}]`);
          console.log(`Got: "${failure.actualTitle}" by ${failure.actualArtist} (${failure.confidence.toFixed(1)}% confidence)`);
          if (failure.fixture.description) {
            console.log(`Note: ${failure.fixture.description}`);
          }
          console.log();
        });
    }

    // Error Analysis
    const errorResults = this.results.filter(r => r.error);
    if (errorResults.length > 0) {
      console.log('\n🚨 ERROR ANALYSIS');
      console.log('-'.repeat(40));
      const errorCounts: Record<string, number> = {};
      for (const result of errorResults) {
        const error = result.error || 'Unknown error';
        errorCounts[error] = (errorCounts[error] || 0) + 1;
      }
      for (const [error, count] of Object.entries(errorCounts)) {
        console.log(`${error}: ${count} occurrences`);
      }
    }

    console.log('\n' + '='.repeat(50));
  }

  /**
   * Save detailed results to JSON file
   */
  async saveDetailedResults(outputPath: string): Promise<void> {
    const summary = this.calculateSummary();
    const output = {
      summary,
      timestamp: new Date().toISOString(),
      results: this.results
    };

    await fs.writeFile(outputPath, JSON.stringify(output, null, 2));
    logger.info({ outputPath }, 'Detailed results saved');
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    await this.prisma.$disconnect();
  }
}

// Main execution
async function main() {
  const fixturePath = process.argv[2] || path.join(process.cwd(), 'fixtures', 'eval.jsonl');
  const outputPath = process.argv[3] || path.join(process.cwd(), 'eval-results.json');

  const harness = new EvaluationHarness();
  
  try {
    // Load and run evaluation
    const fixtures = await harness.loadFixtures(fixturePath);
    await harness.runEvaluation(fixtures);
    
    // Calculate and display results
    const summary = harness.calculateSummary();
    harness.printResults(summary);
    
    // Save detailed results
    await harness.saveDetailedResults(outputPath);
    
    console.log(`\nDetailed results saved to: ${outputPath}`);
    
  } catch (error) {
    logger.error({ error }, 'Evaluation failed');
    process.exit(1);
  } finally {
    await harness.close();
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { EvaluationHarness, type EvalFixture, type EvalResult, type EvalSummary };