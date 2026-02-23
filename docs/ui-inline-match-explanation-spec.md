# UI — Inline Match Explanation Spec

_Created: 2026-02-23_

## 1. Goal

Replace the opt-in "why?" toggle panel with an always-visible inline explanation
card that shows two short lines — **FEELS LIKE** and **FITS WHEN** — directly
beneath the matched song link. This makes the match explanation a first-class
feature, not a debug detail.

## 2. Non-Goals

- No backend/API changes
- No DB schema changes
- No new data fields — uses existing `aboutness.emotions` and `aboutness.moments`
- No V1 legacy aboutness rendering changes beyond stripping confidence tags
- No architectural refactors outside the affected components

## 3. Flow

```
User sends message
  → server returns song match + aboutness (emotions_text, moments_text)
  → chat message renders:
      [user text]
      Musicr picked: Song Title — Artist (Year)  [Loose/Good/Strong match]
        FEELS LIKE  Nostalgic blues reflecting quiet longing
        FITS WHEN   A late-night drive with the window down
  → if aboutness data missing: graceful fallback — show song only, no card
  → no click required; no toggle; no "why?" button
```

## 4. Data + API Changes

None. All data is already in the WebSocket response:

| Field | Source | Used for |
|-------|--------|----------|
| `msg.aboutness.emotions` | `song_aboutness.emotions_text` | FEELS LIKE line |
| `msg.aboutness.moments` | `song_aboutness.moments_text` | FITS WHEN line |
| `msg.similarity` | `scores.confidence` (softmax) | Qualitative strength label |
| `msg.aboutness.emotions_confidence` | `song_aboutness.emotions_confidence` | Debug only (not user-facing) |
| `msg.aboutness.moments_confidence` | `song_aboutness.moments_confidence` | Debug only (not user-facing) |

Text cleanup: a helper strips legacy `[confidence: low/medium/high]` suffixes
from stored text before display. This handles any old V1-era rows.

## 5. Failure Modes

| Failure | Handling |
|---------|---------|
| `aboutness` missing entirely | Render song link only; no explanation card |
| `emotions` or `moments` missing (partial) | Render whichever field exists; omit the other |
| Text contains `[confidence: X]` suffix | Helper strips it before render |
| Very long explanation text (>100c) | CSS `truncate` (single-line ellipsis) |
| `similarity` is undefined | Omit strength label entirely |
| `similarity` < 0.15 | Omit strength label (unreliable at this range) |

## 6. Acceptance Criteria

| # | Criterion |
|---|-----------|
| 1 | Explanation card (FEELS LIKE / FITS WHEN) shown inline with no click required |
| 2 | Card only renders when at least one of `emotions` or `moments` is non-empty |
| 3 | Raw percentage (e.g. "34.3%") never appears in any user-facing element |
| 4 | `[confidence: X]` tag never appears in user-facing text |
| 5 | `[medium]` / `[high]` / `[low]` tag not shown as part of label headers |
| 6 | Qualitative strength label shown cleanly as one of: "Loose match", "Good match", "Strong match" — or hidden when below threshold |
| 7 | If no explanation data, song link renders alone with no empty labels |
| 8 | Each of FEELS LIKE and FITS WHEN renders as single truncated line |
| 9 | No duplicate "why?" button visible in UI |
| 10 | Card visually compact; legible on dark background; works at mobile widths |
| 11 | Debug mode (`?debug=1`) still shows distEmotion / distMoment / aboutScore |
| 12 | Unit tests pass for `cleanAboutnessText` and `getMatchStrengthLabel` helpers |

## UX Decisions Taken

- **Strength label**: Show qualitative ("Loose match" / "Good match" / "Strong match")
  only; no raw %. Below 0.15 similarity, hide entirely.
- **Confidence tags**: Stripped from display. `emotions_confidence` /
  `moments_confidence` kept in data for debug mode but not shown in card.
- **"why?" button**: Removed from primary flow. ESC key dismissal of the old
  expand-panel is also removed (no longer needed).
- **"Matched to:" footer**: Removed (redundant — song link is right above the card).
- **V1 fallback**: Kept for messages without V2 aboutness (old history). V1 mood
  chips / themes / oneLiner still render in debug mode as before.
- **QuickPalette alternates**: Raw score % removed; show song name/artist/year only.
