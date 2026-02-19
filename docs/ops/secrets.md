# Secrets Management

## Where secrets live

All production secrets are stored as **Railway environment variables**, never in the repo.

| Secret | Service | Notes |
|---|---|---|
| `DATABASE_URL` | Railway PostgreSQL addon | Auto-provided; includes password |
| `OPENAI_API_KEY` | Railway `@musicr/api` env | Fallback embedding provider |
| `COOKIE_SECRET` | Railway `@musicr/api` env | Session signing |
| `REDIS_URL` | Railway Redis addon | Auto-provided |

## How to rotate

### OpenAI API key
1. Go to [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
2. Revoke the old key
3. Create a new key
4. Update in Railway: API service > Variables > `OPENAI_API_KEY`
5. Redeploy the API service

### Railway PostgreSQL password
1. Railway dashboard > Musicr project > PostgreSQL service > Settings
2. Click **Reset Credentials**
3. Railway auto-updates `DATABASE_URL` and all `PG*` vars for linked services
4. Redeploy the API service
5. Verify: `GET /health` returns `{"ok": true}`

### Cookie secret
1. Generate a new random string (64+ chars): `openssl rand -hex 32`
2. Update in Railway: API service > Variables > `COOKIE_SECRET`
3. Redeploy (existing sessions will be invalidated)

## Rules

- **Never commit secrets** to the repo — not even in `.env.example` files with real values
- Use `sk-your-key-here` or `postgresql://user:password@host/db` as placeholders
- If a secret is accidentally committed, follow the [history rewrite procedure](#after-a-secret-leak)

## After a secret leak

1. **Rotate the credential immediately** (even before cleaning git history)
2. Rewrite git history using `git filter-repo --replace-text replacements.txt --force`
3. Force-push: `git push --force-with-lease origin main`
4. All collaborators must **re-clone** the repo (see below)
5. If the repo is on GitHub, old commit objects may be cached for up to 90 days; contact GitHub Support to purge if needed

## After a force-push / history rewrite

All collaborators must re-clone:

```bash
# Save any local changes first
cd musicr && git stash

# Re-clone
cd ..
rm -rf musicr
git clone https://github.com/cfiorelli/musicr.git
cd musicr
pnpm install
```

Do **not** use `git pull` — it will create merge conflicts with every rewritten commit.
