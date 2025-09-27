/**
 * Anonymous User Handle Generator
 * 
 * Generates anonymous handles in the format: ${adjective}-${noun}
 * Examples: clever-thunder, brave-mountain, quick-melody
 */

// Curated lists for generating friendly anonymous handles
const adjectives = [
  // Positive personality traits
  'clever', 'brave', 'quick', 'smart', 'bold', 'wise', 'keen', 'bright',
  'swift', 'sharp', 'calm', 'cool', 'warm', 'kind', 'gentle', 'strong',
  'happy', 'jolly', 'merry', 'sunny', 'cheerful', 'lively', 'active', 'energetic',
  'curious', 'friendly', 'honest', 'loyal', 'patient', 'generous', 'humble', 'witty',
  
  // Visual/descriptive
  'silver', 'golden', 'crystal', 'shiny', 'smooth', 'sleek', 'elegant', 'graceful',
  'mighty', 'royal', 'noble', 'cosmic', 'stellar', 'radiant', 'luminous', 'vibrant',
  'tiny', 'giant', 'silent', 'loud', 'soft', 'tough', 'light', 'heavy',
  
  // Nature-inspired
  'wild', 'free', 'natural', 'fresh', 'pure', 'clear', 'bright', 'sparkling',
  'mystic', 'magic', 'dreamy', 'peaceful', 'serene', 'tranquil', 'zen', 'flowing',
  'misty', 'frosty', 'stormy', 'windy', 'cloudy', 'rainy', 'snowy', 'icy',
  
  // Fun/playful
  'funky', 'groovy', 'jazzy', 'rhythmic', 'melodic', 'harmonic', 'acoustic', 'electric',
  'digital', 'pixel', 'neon', 'retro', 'vintage', 'classic', 'modern', 'futuristic',
  'dancing', 'singing', 'jumping', 'flying', 'swimming', 'running', 'walking', 'sleeping'
];

const nouns = [
  // Nature & Weather
  'thunder', 'lightning', 'storm', 'rain', 'snow', 'wind', 'cloud', 'mist', 'fog', 'sunrise',
  'sunset', 'rainbow', 'star', 'moon', 'sun', 'galaxy', 'comet', 'meteor', 'aurora', 'eclipse',
  'mountain', 'valley', 'ocean', 'river', 'lake', 'forest', 'desert', 'island', 'cliff', 'cave',
  'fire', 'ice', 'crystal', 'diamond', 'stone', 'rock', 'sand', 'wave', 'tide', 'current',
  
  // Music & Sound
  'melody', 'rhythm', 'harmony', 'beat', 'song', 'tune', 'note', 'chord', 'symphony', 'ballad',
  'jazz', 'blues', 'rock', 'folk', 'classical', 'opera', 'piano', 'guitar', 'violin', 'drums',
  'echo', 'whisper', 'shout', 'silence', 'voice', 'sound', 'music', 'dance', 'performance', 'concert',
  
  // Abstract Concepts
  'dream', 'hope', 'joy', 'peace', 'love', 'freedom', 'wisdom', 'courage', 'strength', 'magic',
  'mystery', 'wonder', 'adventure', 'journey', 'quest', 'destiny', 'fortune', 'luck', 'chance', 'fate',
  'spirit', 'soul', 'heart', 'mind', 'thought', 'idea', 'vision', 'imagination', 'creativity', 'art',
  
  // Time & Movement
  'moment', 'instant', 'second', 'minute', 'hour', 'day', 'night', 'dawn', 'dusk', 'eternity',
  'speed', 'motion', 'flow', 'drift', 'rush', 'glide', 'leap', 'jump', 'flight', 'journey',
  'path', 'road', 'trail', 'bridge', 'gate', 'door', 'window', 'passage', 'crossing', 'turn',
  
  // Objects & Technology
  'key', 'lock', 'mirror', 'lens', 'prism', 'compass', 'map', 'book', 'page', 'story',
  'pixel', 'code', 'data', 'signal', 'wave', 'frequency', 'network', 'connection', 'link', 'node',
  'engine', 'gear', 'wheel', 'circuit', 'battery', 'spark', 'flame', 'light', 'shadow', 'glow',
  
  // Colors & Textures
  'crimson', 'azure', 'emerald', 'amber', 'violet', 'coral', 'silver', 'golden', 'platinum', 'copper',
  'velvet', 'silk', 'marble', 'steel', 'glass', 'pearl', 'ivory', 'ebony', 'jade', 'ruby',
  'smooth', 'rough', 'soft', 'sharp', 'bright', 'dark', 'clear', 'cloudy', 'shiny', 'matte',
  
  // Places & Spaces
  'garden', 'field', 'meadow', 'grove', 'clearing', 'sanctuary', 'haven', 'refuge', 'shelter', 'home',
  'castle', 'tower', 'palace', 'cottage', 'cabin', 'studio', 'workshop', 'library', 'gallery', 'theater',
  'plaza', 'square', 'street', 'avenue', 'lane', 'alley', 'corner', 'center', 'edge', 'border',
  
  // Feelings & Energy
  'energy', 'power', 'force', 'strength', 'vigor', 'passion', 'fire', 'spark', 'flame', 'blaze',
  'calm', 'serenity', 'tranquil', 'zen', 'balance', 'harmony', 'unity', 'flow', 'grace', 'elegance',
  'excitement', 'thrill', 'rush', 'buzz', 'vibe', 'mood', 'feeling', 'emotion', 'sensation', 'touch',
  
  // Actions & Concepts
  'creation', 'innovation', 'invention', 'discovery', 'exploration', 'research', 'study', 'learning', 'growth', 'progress',
  'change', 'transformation', 'evolution', 'revolution', 'breakthrough', 'achievement', 'success', 'victory', 'triumph', 'glory'
];

/**
 * Generate a random anonymous handle
 * Format: ${adjective}-${noun}
 */
export function generateAnonHandle(): string {
  const adjective = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  
  return `${adjective}-${noun}`;
}

/**
 * Validate that a handle matches the expected format
 */
export function isValidAnonHandle(handle: string): boolean {
  // Check format: word-word
  const pattern = /^[a-z]+-[a-z]+$/;
  return pattern.test(handle);
}

/**
 * Generate multiple unique handles (for testing or batch creation)
 */
export function generateUniqueAnonHandles(count: number): string[] {
  const handles = new Set<string>();
  
  while (handles.size < count) {
    handles.add(generateAnonHandle());
  }
  
  return Array.from(handles);
}

/**
 * Extract components from an anonymous handle
 */
export function parseAnonHandle(handle: string): {
  adjective: string;
  noun: string;
} | null {
  if (!isValidAnonHandle(handle)) {
    return null;
  }
  
  const parts = handle.split('-');
  return {
    adjective: parts[0],
    noun: parts[1]
  };
}