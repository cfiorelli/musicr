/**
 * Anonymous User Handle Generator
 * 
 * Generates anonymous handles in the format: ${adjective}-${animal}
 * Examples: clever-fox, brave-wolf, quick-rabbit
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

const animals = [
  // Common favorites
  'fox', 'wolf', 'bear', 'lion', 'tiger', 'eagle', 'hawk', 'owl', 'cat', 'dog',
  'rabbit', 'deer', 'horse', 'dolphin', 'whale', 'shark', 'octopus', 'penguin', 'seal', 'otter',
  'mouse', 'rat', 'bat', 'bird', 'fish', 'frog', 'bee', 'ant', 'fly', 'worm',
  
  // Exotic/interesting
  'dragon', 'phoenix', 'griffin', 'unicorn', 'pegasus', 'lynx', 'panther', 'jaguar', 'cheetah', 'leopard',
  'falcon', 'raven', 'sparrow', 'robin', 'hummingbird', 'butterfly', 'firefly', 'mantis', 'spider', 'crab',
  'lobster', 'shrimp', 'snail', 'slug', 'beetle', 'cricket', 'grasshopper', 'dragonfly', 'wasp', 'hornet',
  
  // Ocean creatures
  'turtle', 'seahorse', 'starfish', 'jellyfish', 'coral', 'ray', 'barracuda', 'marlin', 'tuna', 'salmon',
  'trout', 'bass', 'cod', 'flounder', 'eel', 'squid', 'clam', 'oyster', 'mussel', 'scallop',
  
  // Land animals
  'squirrel', 'hedgehog', 'raccoon', 'badger', 'mole', 'hamster', 'ferret', 'weasel', 'mongoose',
  'zebra', 'giraffe', 'elephant', 'rhino', 'hippo', 'crocodile', 'lizard', 'gecko', 'chameleon', 'iguana',
  'snake', 'tortoise', 'armadillo', 'sloth', 'koala', 'panda', 'kangaroo', 'wallaby', 'opossum', 'skunk'
];

/**
 * Generate a random anonymous handle
 * Format: ${adjective}-${animal}
 */
export function generateAnonHandle(): string {
  const adjective = adjectives[Math.floor(Math.random() * adjectives.length)];
  const animal = animals[Math.floor(Math.random() * animals.length)];
  
  return `${adjective}-${animal}`;
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
  animal: string;
} | null {
  if (!isValidAnonHandle(handle)) {
    return null;
  }
  
  const parts = handle.split('-');
  return {
    adjective: parts[0],
    animal: parts[1]
  };
}