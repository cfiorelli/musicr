# Musicr Test Fixtures Documentation

This document describes the comprehensive test fixtures created for validating the Musicr song mapping system across diverse scenarios and edge cases.

## Overview

The fixture collection includes:
- **catalog_small.json**: 50 curated songs spanning decades, genres, and moods
- **eval.jsonl**: 60 test cases covering real-world user scenarios
- **eval_golden.jsonl**: Additional golden dataset with scenario-specific tests

## Small Catalog (`catalog_small.json`)

### Song Distribution

**By Decade:**
- 1960s: 2 songs (4%) - Classic rock foundations
- 1970s: 4 songs (8%) - Rock, disco, progressive era
- 1980s: 4 songs (8%) - Pop, rock, new wave explosion
- 1990s: 4 songs (8%) - Grunge, pop, alternative diversity
- 2000s: 4 songs (8%) - Pop, indie, electronic emergence
- 2010s: 20 songs (40%) - Modern pop, streaming era dominance
- 2020s: 12 songs (24%) - Contemporary hits, recent trends

**By Genre:**
- Pop: 28 songs (56%) - Dominant mainstream category
- Rock: 12 songs (24%) - Classic to modern rock variants
- Hip-Hop/Rap: 4 songs (8%) - Contemporary urban music
- R&B: 3 songs (6%) - Soul, contemporary R&B
- Electronic: 3 songs (6%) - Dance, synth, electronic pop
- Alternative: 5 songs (10%) - Indie, alternative rock
- Country: 2 songs (4%) - Traditional and country-pop fusion
- Funk: 4 songs (8%) - Classic funk, neo-funk

**By Mood:**
- Uplifting: 8 songs - Celebration, motivation, joy
- Romantic: 6 songs - Love, relationships, intimacy  
- Empowering: 6 songs - Self-confidence, strength, independence
- Emotional: 5 songs - Heartbreak, deep feelings, vulnerability
- Energetic: 4 songs - High energy, party, workout
- Melancholic: 4 songs - Sadness, nostalgia, introspection
- Confident: 3 songs - Self-assurance, bold attitude
- Nostalgic: 3 songs - Looking back, memories, wistfulness

### Key Features

**Phrase Associations:**
Each song includes 3-5 associated phrases that users might naturally say:
- Direct lyrics ("hey jude", "bohemian rhapsody")
- Descriptive phrases ("take a sad song", "dancing queen")
- Cultural references ("moonwalk", "galileo")
- Emotional contexts ("make it better", "feel the beat")

**Tag Diversity:**
Songs are tagged with multiple categories:
- Genre tags (rock, pop, funk, disco)
- Mood tags (uplifting, romantic, dramatic)
- Era tags (classic rock, 80s, modern)
- Thematic tags (encouragement, party, guitar, piano)
- Cultural tags (california, british, dance floor)

**Popularity Scores:**
Range from 78-98, representing:
- 90-98: Iconic, universally known hits
- 85-89: Very popular, widely recognized
- 80-84: Popular within demographics
- 75-79: Cult classics, niche popularity

## Evaluation Dataset (`eval.jsonl`)

### Scenario Categories

#### 1. **Celebration** (10 test cases)
Real-world celebratory moments that should map to uplifting, party songs:

**Easy Cases:**
- "just got promoted at work!" → Happy, Uptown Funk, September
- "celebrating my birthday today" → Dancing Queen, Happy, September
- "we won the championship!" → Don't Stop Believin', Happy, Shake It Off

**Medium Cases:**
- "wedding bells are ringing" → Dancing Queen, September, Happy
- "graduation party time" → Happy, Dancing Queen, September
- "anniversary dinner tonight" → Shape of You, I Want It That Way, Señorita

#### 2. **Breakup/Heartbreak** (10 test cases)  
Emotional scenarios requiring empathetic song matching:

**Easy Cases:**
- "she broke up with me" → Somebody That I Used to Know, Rolling in the Deep
- "can't get over my ex" → Somebody That I Used to Know, Rolling in the Deep
- "relationship ended badly" → Rolling in the Deep, Somebody That I Used to Know

**Medium Cases:**
- "thought we had forever" → I Will Always Love You, Somebody That I Used to Know  
- "they chose someone else" → Somebody That I Used to Know, Mr. Brightside
- "empty bed feels so cold" → Somebody That I Used to Know, Rolling in the Deep

#### 3. **Commute/Travel Stress** (10 test cases)
Daily frustration scenarios mapping to stress-relief or motivational songs:

**Easy Cases:**
- "stuck in traffic jam" → Stressed Out, Thunder, Don't Stop Believin'
- "running late for work" → Lose Yourself, Stressed Out, Don't Stop Believin'

**Medium Cases:**
- "train is delayed again" → Stressed Out, Don't Stop Believin', Counting Stars
- "missed my connection" → Stressed Out, Don't Stop Believin', Lose Yourself
- "flight got cancelled" → Stressed Out, Don't Stop Believin', Lose Yourself

#### 4. **Weather** (10 test cases)
Weather-influenced moods requiring atmospheric song matching:

**Easy Cases:**
- "sunny day perfect weather" → Happy, Watermelon Sugar, Sunflower
- "heat wave unbearable" → Heat Waves, Watermelon Sugar, Sunflower

**Medium Cases:**
- "it's raining cats and dogs" → Running Up That Hill, Heat Waves, As It Was
- "thunderstorm scary night" → Thunder, Running Up That Hill, Heat Waves
- "perfect beach weather" → Watermelon Sugar, Sunflower, Happy

#### 5. **Cities/Location** (10 test cases)
Geographic references requiring location-aware matching:

**Medium Cases:**
- "love this city so much" → Don't Stop Believin', Happy, Hotel California
- "new york state of mind" → Don't Stop Believin', Lose Yourself, Blinding Lights
- "california dreaming again" → Hotel California, Despacito, Blinding Lights
- "small town boring life" → Don't Stop Believin', Old Town Road, As It Was

#### 6. **Work Stress** (10 test cases)
Professional pressure scenarios requiring stress management songs:

**Easy Cases:**
- "deadline stress overwhelming" → Stressed Out, Lose Yourself, Thunder
- "boss is driving me crazy" → Stressed Out, Lose Yourself, Crazy in Love

**Medium Cases:**
- "overtime again this week" → Stressed Out, Lose Yourself, Don't Stop Believin'
- "monday morning blues" → Stressed Out, As It Was, Don't Stop Believin'
- "thinking about quitting job" → Stressed Out, Don't Stop Believin', Flowers

#### 7. **Invitations/Social** (10 test cases)
Social invitation scenarios mapping to party/social songs:

**Easy Cases:**
- "want to join us tonight?" → Dancing Queen, Happy, September
- "party at my place friday" → Dancing Queen, September, Happy

**Medium Cases:**
- "dinner reservations for two" → Shape of You, I Want It That Way, Señorita  
- "concert tickets available" → Bohemian Rhapsody, Smells Like Teen Spirit
- "beach day this weekend" → Watermelon Sugar, Sunflower, Happy

### Advanced Test Categories

#### 8. **Existential/Philosophical** (5 test cases)
Complex emotional states requiring nuanced matching:
- "feeling lost and confused" → Somebody That I Used to Know, Stressed Out
- "everything is falling apart" → Stressed Out, Somebody That I Used to Know
- "late night overthinking" → Anti-Hero, Stressed Out, As It Was

#### 9. **Motivation/Self-Help** (5 test cases)
Empowerment scenarios requiring motivational songs:
- "need motivation right now" → Don't Stop Believin', Lose Yourself, Happy
- "confidence boost needed" → About Damn Time, Shake It Off, Roar

#### 10. **Obscure/Edge Cases** (5 test cases)
Challenging scenarios testing system limits:
- "quantum physics breakthrough" → Thunder, Counting Stars, Don't Stop Believin'
- "artificial intelligence future" → Blinding Lights, Thunder, Levitating
- "existential dread monday" → Stressed Out, Anti-Hero, As It Was

## Test Case Structure

Each test case includes:

```json
{
  "text": "user input text",
  "expectedTitleIds": ["1", "2", "3", "4"],
  "category": "celebration|breakup|commute|weather|cities|work stress|invitations",
  "difficulty": "easy|medium|hard",
  "tags": ["descriptive", "tags", "for", "categorization"]
}
```

### Difficulty Levels

**Easy (20 cases):**
- Direct emotional mapping
- Clear contextual clues  
- High confidence expected matches
- Single dominant theme

**Medium (30 cases):**
- Multiple valid interpretations
- Cultural/contextual knowledge required
- Moderate ambiguity
- Mixed emotional states

**Hard (10 cases):**
- Highly abstract concepts
- Multiple competing interpretations
- Edge cases and unusual scenarios
- System limitation testing

## Expected Performance Metrics

### Target Hit Rates
- **Easy cases**: 85%+ Top-1, 95%+ Top-3
- **Medium cases**: 65%+ Top-1, 85%+ Top-3  
- **Hard cases**: 35%+ Top-1, 60%+ Top-3
- **Overall**: 70%+ Top-1, 85%+ Top-3

### Category Performance Expectations
- **Celebration**: High accuracy (exact/mood matching)
- **Breakup**: Medium-high (emotional nuance required)
- **Commute**: Medium (stress context understanding)
- **Weather**: Medium-high (atmospheric matching)
- **Cities**: Medium (cultural knowledge required)
- **Work Stress**: Medium-high (relatable context)
- **Invitations**: High (social context clear)

## Usage Examples

### Running Evaluation
```bash
# Run full evaluation suite
pnpm tsx scripts/eval.ts fixtures/eval.jsonl

# Test specific category
grep "celebration" fixtures/eval.jsonl | pnpm tsx scripts/eval.ts

# Test difficulty level  
grep "easy" fixtures/eval.jsonl | pnpm tsx scripts/eval.ts
```

### Integration with Small Catalog
```bash
# Seed database with small catalog
pnpm tsx scripts/seed-small.ts fixtures/catalog_small.json

# Run evaluation against small catalog
pnpm tsx scripts/eval.ts fixtures/eval.jsonl --catalog=small
```

### Performance Analysis
```bash
# Analyze by category
pnpm tsx scripts/eval.ts fixtures/eval.jsonl --breakdown=category

# Analyze by difficulty
pnpm tsx scripts/eval.ts fixtures/eval.jsonl --breakdown=difficulty

# Generate confusion matrix
pnpm tsx scripts/eval.ts fixtures/eval.jsonl --confusion-matrix
```

## Quality Assurance

### Validation Criteria
- ✅ All expectedTitleIds reference valid songs in catalog_small.json
- ✅ Scenarios represent realistic user inputs
- ✅ Difficulty levels appropriately distributed
- ✅ Categories cover major use case spectrum  
- ✅ Edge cases challenge system boundaries
- ✅ Cultural and demographic diversity included

### Manual Review Process
1. **Scenario Authenticity**: Each test case represents genuine user behavior
2. **Expected Matches**: Human-validated appropriate song selections
3. **Difficulty Calibration**: Complexity matches realistic system capabilities  
4. **Coverage Analysis**: All major system features exercised
5. **Bias Assessment**: Demographic and cultural representation evaluated

This fixture collection provides comprehensive validation of the Musicr system across real-world usage patterns, ensuring robust performance evaluation and continuous improvement insights.