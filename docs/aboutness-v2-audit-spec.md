# Aboutness V2 — Cost & Quality Audit Spec

_Created: 2026-02-20_

## Goal

Determine whether the current Aboutness V2 generation is producing data
good enough to justify the cost and runtime of a full 114k-song backfill —
and identify concrete, safe optimizations to apply before continuing.

## Non-Goals

- No schema changes
- No migration runs
- No changes to already-generated rows
- No evaluation of the retrieval/matching quality (that's a separate audit)
- No evaluation of embedding quality (Xenova model assumed fixed)

## Audit Method

1. Read-only DB queries against `song_aboutness` (version=2 rows only)
2. Sample rows across quality strata (random, high-conf, low-conf, popular, unpopular)
3. Score each field 1–5 on five dimensions using the quality rubric below
4. Measure cost from observed output lengths + OpenAI token rates
5. Controlled experiment: compare current vs tighter generation on 10 songs

## Data Sampled

| Stratum | N | Query |
|---------|---|-------|
| Random | 20 | ORDER BY RANDOM() |
| High-confidence emotions | 20 | emotions_confidence = 'high' or 'medium', ORDER BY RANDOM() |
| Low-confidence | 20 | emotions_confidence = 'low', ORDER BY RANDOM() |
| Popular songs | 20 | JOIN songs on popularity DESC LIMIT 20 |
| Less popular songs | 20 | JOIN songs on popularity ASC LIMIT 20 |

Total: up to 100 rows (overlap possible).

## Quality Rubric (1–5 per dimension)

Score each of `emotions_text` and `moments_text` independently:

| Dimension | 1 (bad) | 3 (ok) | 5 (great) |
|-----------|---------|--------|-----------|
| **Specificity** | "haunting, beautiful" | Mentions a genre/tempo cue | Unique detail that wouldn't fit 100 other songs |
| **Plausibility** | Contradicts known song | Plausible but generic | Fits THIS title/artist specifically |
| **Usefulness** | Wouldn't help matching | Might help a broad query | Clearly maps to listener vibe or scene |
| **Clarity** | Verbose/confusing | Readable but padded | Compact, vivid, no filler |
| **Confidence calibration** | High on total guess | Medium when certain | Tag matches actual uncertainty |

### Failure Mode Tags

- `generic-filler`: phrases like "haunting melody", "heartfelt journey" with no specifics
- `overconfident`: `[confidence: high]` on an obscure song the model can't know
- `too-vague`: correct but not useful ("upbeat and energetic")
- `truncated`: text cuts off mid-sentence (artifact of 500-char hard cap)
- `ideal-for-filler`: "ideal for", "perfect for", "great for" constructions (prompt violation)
- `repeated-template`: same sentence structure across multiple songs
- `factual-overreach`: invented details about instrumentation/lyrics
- `confidence-tag-appended`: clearly force-appended tag that doesn't read naturally

## Cost/Speed Questions

1. How many tokens are actually used per song (input + output)?
2. What is the effective average output length vs the 500-char hard cap?
3. Are the two calls parallelized or sequential?
4. Is max_tokens=200 actually the binding constraint?
5. What is the observed throughput (songs/s) and why is it not faster?
6. What is the actual cost per song and projected total?
7. Are retries adding significant cost?

## Acceptance Criteria

| Criterion | Pass threshold |
|-----------|---------------|
| Average quality score (emotions) | ≥ 3.0 / 5.0 |
| Average quality score (moments) | ≥ 3.0 / 5.0 |
| % with zero failure mode tags | ≥ 60% |
| Generic filler rate | < 30% |
| Overconfident rate | < 20% |
| Truncation artifact rate | < 5% |
| Projected total cost | < $50 |
| Projected runtime | < 48 hours |

## Optimization Evaluation Criteria

An optimization passes if it:
- Reduces cost or time by ≥ 20%
- Does NOT reduce average quality score below 3.0
- Does NOT require schema changes
- Does NOT require re-embedding already-generated rows
