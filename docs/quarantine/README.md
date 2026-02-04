# Quarantine Folder

This folder contains removed/quarantined data that should **NEVER** be imported into production.

## Files

### catalog_placeholders.csv (4,405 rows)
**Date Quarantined:** 2026-02-04
**Reason:** Placeholder/synthetic songs removed from catalog

Contains songs that matched placeholder detection rules:
- Adjective+Type patterns: "Blue Song", "Found Track 2"
- Generic two-token titles: "Happy Song"
- Numbered suffixes: "Rising Anthem 3"

Each row includes a `reason` column explaining why it was flagged.

**DO NOT IMPORT** - These are synthetic/generated songs, not real music.

### catalog_clean_ALREADY_IN_SONGS_SEED.csv (247 rows)
**Date:** 2026-02-04
**Status:** Already incorporated into `data/songs_seed.csv`

This was the cleaned catalog output from cleanup script. Its contents have been
merged into the canonical `data/songs_seed.csv` file. Kept here for reference only.

---

**Important:** Files in this folder are for audit/reference purposes only.
Never import these into the database or use them as data sources.
