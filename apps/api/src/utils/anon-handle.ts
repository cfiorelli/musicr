/**
 * Anonymous User Handle Generator
 * 
 * Generates anonymous handles in the format: ${adjective}-${animal}-${nanoid(3)}
 * Examples: clever-fox-a8f, brave-wolf-x2m, quick-rabbit-p9z
 */

import { nanoid } from 'nanoid';

// Curated lists for generating friendly anonymous handles
const adjectives = [
  // Positive personality traits
  'clever', 'brave', 'quick', 'smart', 'bold', 'wise', 'keen', 'bright',
  'swift', 'sharp', 'calm', 'cool', 'warm', 'kind', 'gentle', 'strong',
  'happy', 'jolly', 'merry', 'sunny', 'cheerful', 'lively', 'active', 'energetic',
  
  // Visual/descriptive
  'silver', 'golden', 'crystal', 'shiny', 'smooth', 'sleek', 'elegant', 'graceful',
  'mighty', 'royal', 'noble', 'cosmic', 'stellar', 'radiant', 'luminous', 'vibrant',
  
  // Nature-inspired
  'wild', 'free', 'natural', 'fresh', 'pure', 'clear', 'bright', 'sparkling',
  'mystic', 'magic', 'dreamy', 'peaceful', 'serene', 'tranquil', 'zen', 'flowing',
  
  // Fun/playful
  'funky', 'groovy', 'jazzy', 'rhythmic', 'melodic', 'harmonic', 'acoustic', 'electric',
  'digital', 'pixel', 'neon', 'retro', 'vintage', 'classic', 'modern', 'futuristic'
];

const animals = [
  // Common favorites
  'fox', 'wolf', 'bear', 'lion', 'tiger', 'eagle', 'hawk', 'owl', 'cat', 'dog',
  'rabbit', 'deer', 'horse', 'dolphin', 'whale', 'shark', 'octopus', 'penguin', 'seal', 'otter',
  
  // Exotic/interesting
  'dragon', 'phoenix', 'griffin', 'unicorn', 'pegasus', 'lynx', 'panther', 'jaguar', 'cheetah', 'leopard',
  'falcon', 'raven', 'sparrow', 'robin', 'hummingbird', 'butterfly', 'firefly', 'mantis', 'spider', 'ant',
  
  // Ocean creatures
  'turtle', 'seahorse', 'starfish', 'jellyfish', 'coral', 'ray', 'barracuda', 'marlin', 'tuna', 'salmon',
  
  // Land animals
  'squirrel', 'hedgehog', 'raccoon', 'badger', 'mole', 'mouse', 'hamster', 'ferret', 'weasel', 'mongoose',
  'zebra', 'giraffe', 'elephant', 'rhino', 'hippo', 'crocodile', 'lizard', 'gecko', 'chameleon', 'iguana'
];

/**
 * Generate a random anonymous handle
 * Format: ${adjective}-${animal}-${nanoid(3)}
 */
export function generateAnonHandle(): string {
  const adjective = adjectives[Math.floor(Math.random() * adjectives.length)];
  const animal = animals[Math.floor(Math.random() * animals.length)];
  const randomId = nanoid(3).toLowerCase();
  
  return `${adjective}-${animal}-${randomId}`;
}

/**
 * Validate that a handle matches the expected format
 */
export function isValidAnonHandle(handle: string): boolean {
  // Check format: word-word-xxx where xxx is 3 characters
  const pattern = /^[a-z]+-[a-z]+-[a-z0-9]{3}$/;
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
  id: string;
} | null {
  if (!isValidAnonHandle(handle)) {
    return null;
  }
  
  const parts = handle.split('-');
  return {
    adjective: parts[0],
    animal: parts[1],
    id: parts[2]
  };
}