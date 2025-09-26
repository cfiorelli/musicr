#!/usr/bin/env tsx

/**
 * Phrase Generator Script
 * 
 * Analyzes song titles and lyrics to extract potential phrases/idioms
 * for the phrase lexicon. Generates candidate mappings ranked by relevance.
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface Song {
  id: string;
  title: string;
  artist: string;
  year: number;
  phrases: string;
  tags: string;
  popularity: number;
}

interface PhraseCandidateScore {
  phrase: string;
  songId: string;
  title: string;
  artist: string;
  year: number;
  popularity: number;
  score: number;
  sources: string[];
  frequency: number;
}

interface PhraseAnalysis {
  candidates: PhraseCandidateScore[];
  phraseMap: Record<string, string[]>;
}

class PhraseGenerator {
  private songs: Song[] = [];
  private stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 
    'by', 'from', 'up', 'about', 'into', 'through', 'during', 'before', 'after', 'above', 
    'below', 'under', 'between', 'among', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may',
    'might', 'must', 'can', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her',
    'us', 'them', 'my', 'your', 'his', 'their', 'our', 'this', 'that', 'these', 'those'
  ]);

  private commonPhrases = new Set([
    // Common idioms and expressions
    'break the ice', 'piece of cake', 'spill the beans', 'hit the road', 'under the weather',
    'break a leg', 'bite the bullet', 'cut to the chase', 'hang in there', 'it\'s raining cats and dogs',
    'let the cat out of the bag', 'when pigs fly', 'cost an arm and a leg', 'break the bank',
    
    // Emotional expressions
    'don\'t worry', 'be happy', 'feel good', 'love you', 'miss you', 'need you', 'want you',
    'can\'t stop', 'won\'t stop', 'never give up', 'hold on', 'let go', 'come back', 'stay with me',
    'all night long', 'all day', 'right now', 'forever', 'tonight', 'yesterday', 'tomorrow',
    
    // Places and directions
    'new york', 'california', 'hollywood', 'downtown', 'uptown', 'back home', 'far away',
    'around the world', 'across the street', 'down the road', 'up the hill', 'by the sea',
    
    // Actions and states
    'turn around', 'look back', 'move on', 'slow down', 'speed up', 'wake up', 'fall asleep',
    'stand up', 'sit down', 'walk away', 'come closer', 'reach out', 'hold tight', 'let loose'
  ]);

  async loadSongs(): Promise<void> {
    console.log('🔍 Loading songs from database...');
    
    try {
      // Query the database for all songs
      const query = `
        SELECT id, title, artist, year, 
               COALESCE(array_to_string(phrases, ','), '') as phrases,
               COALESCE(array_to_string(tags, ','), '') as tags,
               popularity
        FROM songs 
        ORDER BY popularity DESC
      `;
      
      const result = execSync(
        `psql -h localhost -p 5432 -U musicr -d musicr -t -A -F'|' -c "${query}"`,
        { encoding: 'utf-8' }
      );
      
      this.songs = result.trim().split('\n')
        .filter(line => line.trim())
        .map(line => {
          const [id, title, artist, year, phrases, tags, popularity] = line.split('|');
          return {
            id: id.trim(),
            title: title.trim(),
            artist: artist.trim(),
            year: parseInt(year) || 0,
            phrases: phrases.trim(),
            tags: tags.trim(),
            popularity: parseFloat(popularity) || 0
          };
        });
      
      console.log(`✅ Loaded ${this.songs.length} songs`);
    } catch (error) {
      console.error('❌ Failed to load songs from database:', error);
      console.log('📝 Falling back to CSV file...');
      this.loadFromCSV();
    }
  }

  private loadFromCSV(): void {
    const csvPath = join(__dirname, '../data/songs_seed.csv');
    const csvData = readFileSync(csvPath, 'utf-8');
    
    const lines = csvData.trim().split('\n').slice(1); // Skip header
    this.songs = lines.map((line, index) => {
      // Simple CSV parsing (handles quotes)
      const matches = line.match(/("(?:[^"\\\\]|\\\\.)*"|[^,]*)/g);
      if (!matches || matches.length < 6) {
        console.warn(`Warning: Invalid CSV line ${index + 1}: ${line}`);
        return null;
      }
      
      const [title, artist, year, popularity, tags, phrases] = matches.map(m => 
        m.replace(/^"(.*)"$/, '$1').replace(/\\"/g, '"')
      );
      
      return {
        id: `generated-${index}`, // Generate temporary ID for CSV data
        title,
        artist,
        year: parseInt(year) || 0,
        phrases: phrases || '',
        tags: tags || '',
        popularity: parseFloat(popularity) || 0
      };
    }).filter(Boolean) as Song[];
  }

  generatePhrases(): PhraseAnalysis {
    console.log('🔤 Generating phrase candidates...');
    
    const candidateScores: PhraseCandidateScore[] = [];
    const phraseFrequency: Record<string, number> = {};
    const phraseSongs: Record<string, Set<string>> = {};

    for (const song of this.songs) {
      // Extract phrases from different sources
      const titlePhrases = this.extractPhrasesFromText(song.title);
      const explicitPhrases = song.phrases ? song.phrases.split(',').map(p => p.trim().toLowerCase()) : [];
      
      const allPhrases = new Set([
        ...titlePhrases,
        ...explicitPhrases,
        ...this.generateNGrams(song.title, 2, 4),
        ...this.extractCommonExpressions(song.title)
      ]);

      for (const phrase of allPhrases) {
        if (phrase.length < 3 || phrase.length > 50) continue;
        
        // Initialize tracking
        if (!phraseFrequency[phrase]) {
          phraseFrequency[phrase] = 0;
          phraseSongs[phrase] = new Set();
        }
        
        phraseFrequency[phrase]++;
        phraseSongs[phrase].add(song.id);
        
        // Calculate relevance score
        const score = this.calculateRelevanceScore(phrase, song, titlePhrases.includes(phrase));
        
        candidateScores.push({
          phrase,
          songId: song.id,
          title: song.title,
          artist: song.artist,
          year: song.year,
          popularity: song.popularity,
          score,
          sources: this.identifySources(phrase, song.title, explicitPhrases),
          frequency: 1
        });
      }
    }

    // Update frequency counts
    for (const candidate of candidateScores) {
      candidate.frequency = phraseFrequency[candidate.phrase];
    }

    // Sort by relevance score
    candidateScores.sort((a, b) => b.score - a.score);
    
    // Build phrase map
    const phraseMap: Record<string, string[]> = {};
    for (const [phrase, songIds] of Object.entries(phraseSongs)) {
      phraseMap[phrase] = Array.from(songIds);
    }

    console.log(`✅ Generated ${candidateScores.length} phrase candidates`);
    
    return { candidates: candidateScores, phraseMap };
  }

  private extractPhrasesFromText(text: string): string[] {
    const normalized = text.toLowerCase()
      .replace(/[^\w\s'-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    
    const phrases: string[] = [];
    
    // Check for common phrases
    for (const phrase of this.commonPhrases) {
      if (normalized.includes(phrase)) {
        phrases.push(phrase);
      }
    }
    
    return phrases;
  }

  private generateNGrams(text: string, minN: number, maxN: number): string[] {
    const words = text.toLowerCase()
      .replace(/[^\w\s'-]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 1 && !this.stopWords.has(word));
    
    const ngrams: string[] = [];
    
    for (let n = minN; n <= maxN; n++) {
      for (let i = 0; i <= words.length - n; i++) {
        const ngram = words.slice(i, i + n).join(' ');
        if (ngram.length >= 4 && ngram.length <= 30) {
          ngrams.push(ngram);
        }
      }
    }
    
    return ngrams;
  }

  private extractCommonExpressions(text: string): string[] {
    const expressions: string[] = [];
    const normalized = text.toLowerCase();
    
    // Common patterns in song titles
    const patterns = [
      /(\w+\s+you)/g,        // "love you", "need you", etc.
      /(\w+\s+me)/g,         // "save me", "hold me", etc.
      /(don't\s+\w+)/g,      // "don't worry", "don't stop", etc.
      /(can't\s+\w+)/g,      // "can't help", "can't stop", etc.
      /(all\s+\w+)/g,        // "all night", "all day", etc.
      /(never\s+\w+)/g,      // "never again", "never mind", etc.
      /(\w+\s+tonight)/g,    // "dance tonight", etc.
      /(\w+\s+forever)/g,    // "love forever", etc.
    ];
    
    for (const pattern of patterns) {
      const matches = normalized.match(pattern);
      if (matches) {
        expressions.push(...matches.map(m => m.trim()));
      }
    }
    
    return expressions;
  }

  private calculateRelevanceScore(phrase: string, song: Song, inTitle: boolean): number {
    let score = 0;
    
    // Base score from popularity
    score += song.popularity * 0.3;
    
    // Bonus for being in title vs phrases
    if (inTitle) {
      score += 50;
    } else {
      score += 20;
    }
    
    // Bonus for phrase length (sweet spot)
    const length = phrase.length;
    if (length >= 6 && length <= 20) {
      score += 30;
    } else if (length >= 4 && length <= 30) {
      score += 10;
    }
    
    // Bonus for common expressions
    if (this.commonPhrases.has(phrase)) {
      score += 40;
    }
    
    // Penalty for very common words
    const commonWords = ['love', 'baby', 'girl', 'boy', 'heart', 'time', 'life', 'world'];
    const wordCount = commonWords.reduce((count, word) => 
      phrase.includes(word) ? count + 1 : count, 0);
    score -= wordCount * 5;
    
    // Bonus for unique phrases
    const words = phrase.split(' ');
    const uniqueWords = new Set(words);
    if (uniqueWords.size === words.length && words.length > 1) {
      score += 15;
    }
    
    return Math.max(0, score);
  }

  private identifySources(phrase: string, title: string, explicitPhrases: string[]): string[] {
    const sources: string[] = [];
    
    if (title.toLowerCase().includes(phrase)) {
      sources.push('title');
    }
    
    if (explicitPhrases.some(p => p.includes(phrase))) {
      sources.push('explicit_phrases');
    }
    
    if (this.commonPhrases.has(phrase)) {
      sources.push('common_expression');
    }
    
    sources.push('ngram');
    
    return sources;
  }

  saveAnalysis(analysis: PhraseAnalysis): void {
    console.log('💾 Saving phrase analysis...');
    
    // Save top candidates for manual review
    const topCandidates = analysis.candidates.slice(0, 500);
    const candidatesPath = join(__dirname, '../data/phrase_candidates.json');
    writeFileSync(candidatesPath, JSON.stringify(topCandidates, null, 2));
    
    // Save curated phrase map (top 300)
    const topPhrases = analysis.candidates
      .slice(0, 300)
      .reduce((acc, candidate) => {
        if (!acc[candidate.phrase]) {
          acc[candidate.phrase] = [];
        }
        if (!acc[candidate.phrase].includes(candidate.songId)) {
          acc[candidate.phrase].push(candidate.songId);
        }
        return acc;
      }, {} as Record<string, string[]>);
    
    const phrasesPath = join(__dirname, '../data/phrases.json');
    writeFileSync(phrasesPath, JSON.stringify(topPhrases, null, 2));
    
    console.log(`✅ Saved ${topCandidates.length} candidates to phrase_candidates.json`);
    console.log(`✅ Saved top ${Object.keys(topPhrases).length} phrases to phrases.json`);
    
    // Generate summary report
    this.generateReport(analysis, topCandidates.slice(0, 50));
  }

  private generateReport(analysis: PhraseAnalysis, topCandidates: PhraseCandidateScore[]): void {
    console.log('\n📊 PHRASE GENERATION REPORT');
    console.log('=' .repeat(50));
    console.log(`Total songs analyzed: ${this.songs.length}`);
    console.log(`Total phrase candidates: ${analysis.candidates.length}`);
    console.log(`Unique phrases: ${Object.keys(analysis.phraseMap).length}`);
    
    console.log('\n🏆 TOP 20 PHRASE CANDIDATES:');
    console.log('-'.repeat(80));
    console.log('Score | Phrase'.padEnd(35) + '| Song'.padEnd(30) + '| Artist');
    console.log('-'.repeat(80));
    
    for (const candidate of topCandidates.slice(0, 20)) {
      const scoreStr = candidate.score.toFixed(1).padStart(5);
      const phraseStr = `"${candidate.phrase}"`.padEnd(35);
      const songStr = candidate.title.substring(0, 25).padEnd(30);
      const artistStr = candidate.artist.substring(0, 20);
      
      console.log(`${scoreStr} | ${phraseStr}| ${songStr}| ${artistStr}`);
    }
    
    console.log('\n💡 RECOMMENDATIONS:');
    console.log('1. Review phrase_candidates.json for manual curation');
    console.log('2. Remove irrelevant or too-generic phrases');
    console.log('3. Add domain-specific phrases (music terms, emotions, etc.)');
    console.log('4. Consider phrase variations and synonyms');
    
    const reportPath = join(__dirname, '../data/phrase_generation_report.txt');
    const report = [
      'PHRASE GENERATION REPORT',
      `Generated at: ${new Date().toISOString()}`,
      '',
      `Total songs analyzed: ${this.songs.length}`,
      `Total phrase candidates: ${analysis.candidates.length}`,
      `Unique phrases: ${Object.keys(analysis.phraseMap).length}`,
      '',
      'TOP 50 CANDIDATES:',
      'Score | Phrase | Song | Artist | Sources',
      ...topCandidates.slice(0, 50).map(c => 
        `${c.score.toFixed(1)} | "${c.phrase}" | ${c.title} | ${c.artist} | ${c.sources.join(',')}`
      )
    ].join('\n');
    
    writeFileSync(reportPath, report);
    console.log(`📋 Full report saved to phrase_generation_report.txt`);
  }
}

// Main execution
async function main() {
  console.log('🎵 PHRASE LEXICON GENERATOR');
  console.log('=' .repeat(50));
  
  const generator = new PhraseGenerator();
  
  try {
    await generator.loadSongs();
    const analysis = generator.generatePhrases();
    generator.saveAnalysis(analysis);
    
    console.log('\n🎉 Phrase generation complete!');
    console.log('Next steps:');
    console.log('1. Review data/phrase_candidates.json');
    console.log('2. Manually curate phrases in data/phrases.json'); 
    console.log('3. Integrate phrase matching into song matching service');
    
  } catch (error) {
    console.error('❌ Error generating phrases:', error);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { PhraseGenerator };