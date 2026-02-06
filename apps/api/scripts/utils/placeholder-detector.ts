/**
 * Placeholder Song Detection Utility
 *
 * Identifies synthetic/test songs that should never be in production catalog.
 * Used by cleanup scripts and seed validators.
 */

export interface SongRow {
  title: string;
  artist: string;
  phrases?: string;
  source?: string;  // e.g., "musicbrainz"
  mbid?: string;    // MusicBrainz ID
}

/**
 * Check if a song is a placeholder/synthetic test entry
 */
export function isPlaceholderSong(row: SongRow): boolean {
  const title = row.title.trim();

  // Rule 1: Exact matches for known placeholders
  const exactMatches = [
    'Found Song', 'Found Track',
    'True Song', 'True Track',
    'Lost Song', 'Lost Track'
  ];

  if (exactMatches.includes(title)) {
    return true;
  }

  // Rule 2: Pattern match for "${Adjective} ${Type}" format
  // Types: Song, Track, Anthem, Hit, Tune, Number, Single, Piece, Jam, Record, Ballad, Beat
  const typeWords = [
    'Song', 'Track', 'Anthem', 'Hit', 'Tune', 'Number',
    'Single', 'Piece', 'Jam', 'Record', 'Ballad', 'Beat'
  ];

  // Common placeholder adjectives from generator
  const adjectives = [
    'Blue', 'Red', 'Golden', 'Silver', 'Dark', 'Bright',
    'Sweet', 'Wild', 'Free', 'Lost', 'Found', 'True',
    'Faded', 'Shining', 'Burning', 'Rising'
  ];

  // Match: "^(Adjective) (Type)( \d+)?$"
  const simplePattern = new RegExp(
    `^(${adjectives.join('|')})\\s+(${typeWords.join('|')})(\\s+\\d+)?$`,
    'i'
  );

  if (simplePattern.test(title)) {
    return true;
  }

  // Rule 3: Title is ONLY "Song" or "Track" with single word prefix
  // Examples: "Blue Song", "Red Track", "Happy Song"
  // SKIP this rule for verified MusicBrainz records (they may have legitimate titles like "Ghost Song")
  const isMusicBrainzRecord = row.source === 'musicbrainz' && row.mbid;
  if (!isMusicBrainzRecord) {
    const tokens = title.split(/\s+/);
    if (tokens.length === 2) {
      const lastToken = tokens[1];
      if (typeWords.includes(lastToken)) {
        // This catches any "X Song" or "X Track" pattern
        return true;
      }
    }
  }

  // Rule 4: Numbered placeholder patterns (e.g., "Test Song 123", "My Track 1")
  // Only match if it's clearly a placeholder format with test/demo prefixes
  // SKIP very generic patterns like "Song 1" or "Track 2" for verified MusicBrainz records
  // (they may be legitimate songs with generic titles)
  const placeholderPrefixes = ['Test', 'Demo', 'My', 'Sample', 'Fake', 'Example', 'Placeholder'];
  const genericNumberedPattern = new RegExp(
    `^(${placeholderPrefixes.join('|')})\\s+(${typeWords.join('|')})\\s+\\d+$`,
    'i'
  );

  // Only match very generic "Song 1" / "Track 2" patterns for non-MusicBrainz records
  if (!isMusicBrainzRecord) {
    const veryGenericPattern = new RegExp(
      `^(${typeWords.join('|')})\\s+\\d+$`,
      'i'
    );

    if (veryGenericPattern.test(title)) {
      return true;
    }
  }

  if (genericNumberedPattern.test(title)) {
    return true;
  }

  // Rule 5: Trivial phrases that just tokenize title/artist
  // Example: phrases = "blue,song,beatles" for title "Blue Song" by "Beatles"
  if (row.phrases) {
    const phrasesLower = row.phrases.toLowerCase();
    const titleLower = title.toLowerCase();
    const artistLower = row.artist.toLowerCase();

    // Check if phrases are just comma-separated title words + artist
    const titleWords = titleLower.split(/\s+/).filter(w => w.length > 0);
    const phraseWords = phrasesLower.split(',').map(p => p.trim()).filter(p => p.length > 0);

    // If phrases exactly match title words + artist (any order), it's synthetic
    const expectedPhrases = [...titleWords, ...artistLower.split(/\s+/)];
    const allMatch = phraseWords.every(p => expectedPhrases.includes(p));
    const sameLength = phraseWords.length === expectedPhrases.length;

    if (allMatch && sameLength && phraseWords.length <= 4) {
      return true;
    }
  }

  return false;
}

/**
 * Get reason why a song was flagged as placeholder (for debugging)
 */
export function getPlaceholderReason(row: SongRow): string | null {
  const title = row.title.trim();

  const exactMatches = ['Found Song', 'Found Track', 'True Song', 'True Track', 'Lost Song', 'Lost Track'];
  if (exactMatches.includes(title)) {
    return `Exact match: "${title}"`;
  }

  const typeWords = ['Song', 'Track', 'Anthem', 'Hit', 'Tune', 'Number', 'Single', 'Piece', 'Jam', 'Record', 'Ballad', 'Beat'];
  const adjectives = ['Blue', 'Red', 'Golden', 'Silver', 'Dark', 'Bright', 'Sweet', 'Wild', 'Free', 'Lost', 'Found', 'True', 'Faded', 'Shining', 'Burning', 'Rising'];

  const simplePattern = new RegExp(`^(${adjectives.join('|')})\\s+(${typeWords.join('|')})(\\s+\\d+)?$`, 'i');
  if (simplePattern.test(title)) {
    return `Adjective+Type pattern: "${title}"`;
  }

  // Skip "Simple type suffix" rule for verified MusicBrainz records
  const isMusicBrainzRecord = row.source === 'musicbrainz' && row.mbid;
  if (!isMusicBrainzRecord) {
    const tokens = title.split(/\s+/);
    if (tokens.length === 2 && typeWords.includes(tokens[1])) {
      return `Simple type suffix: "${title}"`;
    }
  }

  const placeholderPrefixes = ['Test', 'Demo', 'My', 'Sample', 'Fake', 'Example', 'Placeholder'];
  const genericNumberedPattern = new RegExp(`^(${placeholderPrefixes.join('|')})\\s+(${typeWords.join('|')})\\s+\\d+$`, 'i');

  if (genericNumberedPattern.test(title)) {
    return `Numbered placeholder: "${title}"`;
  }

  // Only check very generic pattern for non-MusicBrainz records
  if (!isMusicBrainzRecord) {
    const veryGenericPattern = new RegExp(`^(${typeWords.join('|')})\\s+\\d+$`, 'i');
    if (veryGenericPattern.test(title)) {
      return `Numbered placeholder: "${title}"`;
    }
  }

  if (row.phrases) {
    const phrasesLower = row.phrases.toLowerCase();
    const titleLower = title.toLowerCase();
    const artistLower = row.artist.toLowerCase();
    const titleWords = titleLower.split(/\s+/).filter(w => w.length > 0);
    const phraseWords = phrasesLower.split(',').map(p => p.trim()).filter(p => p.length > 0);
    const expectedPhrases = [...titleWords, ...artistLower.split(/\s+/)];
    const allMatch = phraseWords.every(p => expectedPhrases.includes(p));
    const sameLength = phraseWords.length === expectedPhrases.length;

    if (allMatch && sameLength && phraseWords.length <= 4) {
      return `Trivial phrases: "${row.phrases}"`;
    }
  }

  return null;
}
