import { describe, it, expect } from 'vitest';
import { cleanAboutnessText, getMatchStrengthLabel } from '../songMatch';

describe('cleanAboutnessText', () => {
  it('strips [confidence: medium] suffix', () => {
    expect(cleanAboutnessText('Melancholic blues [confidence: medium]'))
      .toBe('Melancholic blues');
  });

  it('strips [confidence: high] suffix', () => {
    expect(cleanAboutnessText('Upbeat dance vibe [confidence: high]'))
      .toBe('Upbeat dance vibe');
  });

  it('strips [confidence: low] suffix', () => {
    expect(cleanAboutnessText('Mysterious and quiet [confidence: low]'))
      .toBe('Mysterious and quiet');
  });

  it('is case-insensitive for the tag', () => {
    expect(cleanAboutnessText('Some text [Confidence: High]'))
      .toBe('Some text');
  });

  it('returns clean text unchanged', () => {
    expect(cleanAboutnessText('No suffix here at all'))
      .toBe('No suffix here at all');
  });

  it('trims surrounding whitespace', () => {
    expect(cleanAboutnessText('  Padded text  '))
      .toBe('Padded text');
  });

  it('handles text that ends with just the tag and extra whitespace', () => {
    expect(cleanAboutnessText('Pure tag [confidence: medium]   '))
      .toBe('Pure tag');
  });

  it('handles empty string', () => {
    expect(cleanAboutnessText('')).toBe('');
  });
});

describe('getMatchStrengthLabel', () => {
  it('returns null for undefined', () => {
    expect(getMatchStrengthLabel(undefined)).toBeNull();
  });

  it('returns null below threshold (< 0.15)', () => {
    expect(getMatchStrengthLabel(0)).toBeNull();
    expect(getMatchStrengthLabel(0.10)).toBeNull();
    expect(getMatchStrengthLabel(0.14)).toBeNull();
  });

  it('returns Loose match in 0.15–0.29 range', () => {
    expect(getMatchStrengthLabel(0.15)?.label).toBe('Loose match');
    expect(getMatchStrengthLabel(0.25)?.label).toBe('Loose match');
    expect(getMatchStrengthLabel(0.29)?.label).toBe('Loose match');
  });

  it('returns Good match in 0.30–0.49 range', () => {
    expect(getMatchStrengthLabel(0.30)?.label).toBe('Good match');
    expect(getMatchStrengthLabel(0.40)?.label).toBe('Good match');
    expect(getMatchStrengthLabel(0.49)?.label).toBe('Good match');
  });

  it('returns Strong match at >= 0.50', () => {
    expect(getMatchStrengthLabel(0.5)?.label).toBe('Strong match');
    expect(getMatchStrengthLabel(0.75)?.label).toBe('Strong match');
    expect(getMatchStrengthLabel(1.0)?.label).toBe('Strong match');
  });

  it('each label carries a non-empty color class', () => {
    expect(getMatchStrengthLabel(0.6)?.color).toBeTruthy();
    expect(getMatchStrengthLabel(0.4)?.color).toBeTruthy();
    expect(getMatchStrengthLabel(0.2)?.color).toBeTruthy();
  });
});
