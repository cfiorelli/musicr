# Catalog Management Guide

## Canonical Source of Truth

**Single canonical catalog:** `apps/api/data/songs_seed.csv`

This file is:
- ✅ The **ONLY** file used by seed/import scripts
- ✅ Validated to contain **ZERO** placeholder songs
- ✅ Manually curated with real music data
- ✅ Version-controlled and production-ready

**Row count:** 247 real songs

---

## Validation & Safety

### Before Importing

**Always validate the catalog before seeding:**

```bash
cd apps/api
pnpm catalog:validate
```

Expected output:
```
🔍 Validating canonical catalog: songs_seed.csv
📊 Total rows: 247
✅ PASS: No placeholder songs detected
✅ Catalog is clean and ready for import
```

If validation fails, **DO NOT import**. Fix the catalog first.

### Automatic Validation

The `pnpm seed` command automatically runs validation before importing:

```bash
pnpm seed
# Runs: validate-catalog.ts → seed.ts
```

If validation fails, seeding is aborted.

---

## Placeholder Detection Rules

Songs are flagged as placeholders if they match any of these patterns:

1. **Exact matches:** "Found Song", "True Track", "Lost Song"
2. **Adjective+Type:** "Blue Song", "Golden Track 2", "Rising Anthem"
3. **Simple two-token:** Generic "Happy Song", "Sad Track"
4. **Numbered suffixes:** "Something Song 2", "Thing Track 10"
5. **Trivial phrases:** Tokens that exactly match the title

### Why Placeholders Are Bad

- ❌ Degrade matching quality (user asks for "happy songs", gets "Happy Song" placeholder)
- ❌ Pollute database with synthetic data
- ❌ Confuse users with generic, meaningless titles
- ❌ Waste resources indexing fake songs

---

## Quarantined/Archived Files

### 🚫 DO NOT USE

**Location:** `docs/archive/catalog_contaminated_DO_NOT_USE.csv`

- **Original name:** 5k_songs.csv
- **Contamination:** 94.7% placeholder songs (4,405 of 4,652)
- **Status:** QUARANTINED - Never import this file
- **Why it exists:** Historical artifact from generator script

### 📋 Reference Only

**Location:** `docs/quarantine/`

Contains:
- `catalog_placeholders.csv` - 4,405 removed placeholders with reasons
- `catalog_clean_ALREADY_IN_SONGS_SEED.csv` - Clean output (already in songs_seed.csv)
- `README.md` - Quarantine folder documentation

These files are for audit/reference purposes only.

---

## Adding New Songs

### Option 1: Manual CSV Editing (Small Additions)

1. Edit `apps/api/data/songs_seed.csv` directly
2. Follow existing format:
   ```csv
   title,artist,year,popularity,tags,phrases
   "Song Title","Artist Name",2020,85,"pop,dance","catchy,hook,lyrics"
   ```
3. Validate:
   ```bash
   pnpm catalog:validate
   ```
4. If validation passes, commit and seed

### Option 2: Import from External Source (Large Additions)

1. Export data from MusicBrainz/Spotify/etc.
2. Clean and format to match songs_seed.csv schema
3. Run placeholder detection:
   ```bash
   pnpm catalog:clean  # Processes archived contaminated file
   # Manually review output in docs/quarantine/
   ```
4. Append clean rows to `songs_seed.csv`
5. Validate:
   ```bash
   pnpm catalog:validate
   ```
6. Seed database:
   ```bash
   pnpm seed
   ```

### ⚠️ NEVER Add Placeholders

Placeholder patterns are **permanently banned**:
- ❌ "Blue Song", "Golden Track"
- ❌ "Found Song 2", "Rising Anthem"
- ❌ Generic "Happy Song" titles

The validation script will catch and reject these.

---

## Scripts Reference

### `pnpm catalog:validate`
**Purpose:** Validates songs_seed.csv contains no placeholders
**Usage:** Run before seeding or committing catalog changes
**Exit code:** 0 if clean, 1 if placeholders found
**File:** `scripts/validate-catalog.ts`

### `pnpm catalog:clean`
**Purpose:** Cleans contaminated CSV files (processes archived file)
**Usage:** Recovery/reference only - processes docs/archive/catalog_contaminated_DO_NOT_USE.csv
**Output:** docs/quarantine/ folder
**File:** `scripts/clean-catalog.ts`

**⚠️ Note:** This script does NOT modify production data. It only processes the archived contaminated file for reference.

### `pnpm seed`
**Purpose:** Import songs_seed.csv into database
**Behavior:** Automatically runs validation first
**File:** `scripts/seed.ts`

---

## CI/CD Integration (Recommended)

Add to your CI pipeline:

```yaml
# .github/workflows/test.yml
- name: Validate catalog
  run: |
    cd apps/api
    pnpm catalog:validate
```

This prevents contaminated catalogs from being merged.

---

## Troubleshooting

### "Found X placeholder songs in canonical catalog"

**Solution:**
1. Do NOT import the catalog
2. Review offending titles in output
3. Either:
   - Remove placeholder rows manually
   - OR replace songs_seed.csv with known-clean backup
4. Run `pnpm catalog:validate` again
5. Only seed when validation passes

### "Canonical catalog not found at data/songs_seed.csv"

**Solution:**
- Check you're in `apps/api/` directory
- Verify file exists: `ls -la data/songs_seed.csv`
- If missing, restore from version control or clean archive

### "Script references 5k_songs.csv"

**Solution:**
- The contaminated file has been moved to `docs/archive/catalog_contaminated_DO_NOT_USE.csv`
- Update script to reference `songs_seed.csv` instead
- Never reference archived contaminated files in production code

---

## History

### 2026-02-04: Placeholder Elimination Project

**Problem:** 94.7% of 5k_songs.csv was placeholder/synthetic songs

**Actions Taken:**
1. Created placeholder detection rules (5 patterns)
2. Ran cleanup script → 247 real songs, 4,405 placeholders removed
3. Replaced songs_seed.csv with clean catalog (247 songs)
4. Quarantined contaminated 5k_songs.csv → docs/archive/
5. Added validation guardrails to prevent reintroduction
6. Disabled generateVariations() function that created placeholders

**Result:** 100% real songs in production catalog, with guardrails preventing regression

---

## Key Principles

1. ✅ **Single source of truth:** songs_seed.csv only
2. ✅ **Validate before import:** Always run catalog:validate
3. ✅ **Never import placeholders:** Strict detection rules enforced
4. ✅ **Quarantine, don't delete:** Contaminated files archived for audit
5. ✅ **Fail fast:** Validation errors abort seeding immediately

---

**Last Updated:** 2026-02-04
**Canonical Catalog:** apps/api/data/songs_seed.csv (247 rows)
**Validation Script:** apps/api/scripts/validate-catalog.ts
**Cleanup Script:** apps/api/scripts/clean-catalog.ts
