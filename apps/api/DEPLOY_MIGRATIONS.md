# Deployment Runbook: Ensuring Migrations Run on Railway

## Problem

Production deployments were failing with:
```
PrismaClientKnownRequestError: column songs.is_placeholder does not exist
```

**Root Cause:** Migrations weren't running automatically on Railway deployment, causing schema drift between code and database.

## Solution

Railway now automatically runs migrations before starting the server via `pnpm start:railway`.

---

## Automatic Migration on Deploy (✅ Configured)

### Railway Configuration

**File:** `apps/api/railway.toml`
```toml
[deploy]
startCommand = "pnpm start:railway"
```

**Package.json Scripts:**
```json
{
  "start:railway": "prisma migrate deploy && node dist/index.js",
  "db:migrate:deploy": "prisma migrate deploy"
}
```

**What Happens on Deploy:**
1. Railway builds the app (`pnpm build`)
2. Railway runs `pnpm start:railway`
3. Prisma applies pending migrations (`prisma migrate deploy`)
4. Server starts (`node dist/index.js`)
5. Boot-time guard verifies schema has required columns

---

## Verification Steps (After Deploy)

### 1. Check Railway Logs for Migration Success

Look for:
```
✅ Running migrations...
✅ Applied migration: 20260204141511_add_is_placeholder_column
✅ Schema migration check passed
```

If you see migration errors, check the database connection string and permissions.

### 2. Verify Column Exists (Optional - psql)

Connect to Railway database:
```bash
# Get DATABASE_URL from Railway dashboard
psql $DATABASE_URL
```

Check schema:
```sql
\d songs

-- Should show:
-- is_placeholder | boolean | not null default false
```

### 3. Smoke Test: Send Message

Send a message in the chat and verify:
- No 500 errors
- Song matching works
- Logs show "Schema migration check passed"

---

## Emergency: Manual Migration (If Automatic Deploy Fails)

### Option 1: Run Migration via Railway CLI

```bash
railway link  # Link to your project
railway run --service api pnpm db:migrate:deploy
```

### Option 2: Direct SQL (Last Resort)

Connect to database and run:
```sql
-- Add is_placeholder column if missing
ALTER TABLE public.songs
ADD COLUMN IF NOT EXISTS is_placeholder boolean NOT NULL DEFAULT false;

-- Create index
CREATE INDEX IF NOT EXISTS idx_songs_is_placeholder ON public.songs(is_placeholder);

-- Verify
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'songs' AND column_name = 'is_placeholder';
```

**Important:** Only use this if automatic migration fails. The canonical fix is `prisma migrate deploy`.

---

## Boot-Time Safety Guard

The server includes a boot-time check that verifies the schema is up to date:

```typescript
// Check if is_placeholder column exists
await prisma.$queryRaw`SELECT is_placeholder FROM songs LIMIT 0`;
```

**If migrations haven't run, the server will:**
1. Log a clear FATAL error message
2. Show exact commands to fix the issue
3. Exit with code 1 (prevent serving broken API)

**Example Error Output:**
```
❌ FATAL: Database schema is out of date!

Required migration has not been applied to the database.

To fix this:
  1. Run: pnpm db:migrate:deploy
  2. Or emergency SQL: ALTER TABLE songs ADD COLUMN IF NOT EXISTS is_placeholder boolean NOT NULL DEFAULT false;
  3. Then restart the server

If deploying to Railway, ensure startCommand runs migrations:
  startCommand = "pnpm start:railway" (runs migrations + starts server)
```

---

## Migration Status Check (Development)

Check pending migrations:
```bash
cd apps/api
pnpm prisma migrate status
```

Apply migrations locally:
```bash
pnpm db:migrate:deploy  # Production-safe (applies only, no prompts)
# OR
pnpm db:migrate         # Development (creates new migrations, prompts for name)
```

---

## How to Deploy Safely

### Standard Deployment (GitHub → Railway)

1. **Commit and push:**
   ```bash
   git add .
   git commit -m "Your changes"
   git push origin main
   ```

2. **Railway auto-deploys:**
   - Detects changes
   - Runs `pnpm build`
   - Runs `pnpm start:railway` (migrations + start)

3. **Verify in Railway logs:**
   - Check for "Applied migration: ..." messages
   - Check for "Schema migration check passed"
   - Check for "Server listening on ..."

### Manual Deployment (Railway CLI)

```bash
railway up --service api
```

Railway will use the same `start:railway` command.

---

## Troubleshooting

### "Migration already applied" Warning

This is **normal** if migrations were already run. Railway logs will show:
```
No pending migrations to apply.
```

Then proceeds to start the server.

### "Migration failed: permission denied"

**Fix:** Ensure the database user has `CREATE` and `ALTER` permissions.

Railway's default PostgreSQL addon should have correct permissions. If using external database, grant:
```sql
GRANT CREATE, ALTER ON DATABASE your_db TO your_user;
```

### "Cannot find module 'prisma'"

**Fix:** Ensure `prisma` is in `dependencies` (not `devDependencies`) in package.json.

```json
{
  "dependencies": {
    "prisma": "^5.11.0"
  }
}
```

### Server Starts But Queries Fail

If server starts but queries fail with "column does not exist":
1. Check Railway logs for migration success
2. Manually run: `railway run --service api pnpm db:migrate:deploy`
3. Restart Railway service

---

## Key Files Modified

**Package.json Scripts:**
- Added `start:railway` - Runs migrations then starts server
- Added `db:migrate:deploy` - Production-safe migration command

**Railway Config:**
- `apps/api/railway.toml` - Sets `startCommand = "pnpm start:railway"`

**Boot Guard:**
- `apps/api/src/index.ts` - Verifies schema on startup, fails fast if migrations missing

**Migration:**
- `apps/api/prisma/migrations/20260204141511_add_is_placeholder_column/migration.sql`

---

## Migration History

**2026-02-04:** Added `is_placeholder` column to songs table
- **Migration:** `20260204141511_add_is_placeholder_column`
- **Purpose:** Track and exclude synthetic/placeholder songs from matching
- **Schema:** `is_placeholder boolean NOT NULL DEFAULT false`
- **Index:** `idx_songs_is_placeholder`

---

## Best Practices

1. ✅ **Never skip migrations** - Always run `prisma migrate deploy` before starting
2. ✅ **Test locally first** - Run migrations on dev database before pushing
3. ✅ **Check migration status** - Use `prisma migrate status` before deploying
4. ✅ **Monitor Railway logs** - Confirm migrations applied successfully
5. ✅ **Use boot guard** - Let the server fail fast if schema is wrong
6. ❌ **Don't use direct SQL** - Unless automatic migration fails
7. ❌ **Don't bypass migrations** - They ensure schema consistency

---

**Last Updated:** 2026-02-04
**Related:** [RUNBOOK.md](../../../RUNBOOK.md), [schema.prisma](./prisma/schema.prisma)
