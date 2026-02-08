# Security

## Where secrets live

Production secrets are stored **only** in Railway environment variables. They must never appear in source code, git history, CI logs, or documentation.

| Secret | Set in | Used by |
|--------|--------|---------|
| `DATABASE_URL` | Railway PostgreSQL addon (auto-provided) | `@musicr/api` |
| `OPENAI_API_KEY` | Railway dashboard | `@musicr/api` |
| `COOKIE_SECRET` | Railway dashboard | `@musicr/api` |
| `REDIS_URL` | Railway Redis addon (auto-provided) | `@musicr/api` |

Local development uses `.env` files that are gitignored. See `.env.example` for the template.

## Automated checks

- **Gitleaks** runs on every push to `main` and every PR (`.github/workflows/secret-scan.yml`). Builds fail if secret patterns are detected in committed files.
- **Dependabot** opens PRs for outdated dependencies weekly (`.github/dependabot.yml`).
- **GitHub security alerts** should be enabled in repo Settings > Code security and analysis. This cannot be configured from code — the repo owner must enable:
  - Dependency graph
  - Dependabot alerts
  - Dependabot security updates
  - Secret scanning (if available on your plan)

## Pre-commit guidance

For additional local protection, you can run gitleaks before committing:

```bash
# Install: brew install gitleaks  (or see https://github.com/gitleaks/gitleaks)
gitleaks detect --source . --verbose
```

This is optional — CI will catch leaks regardless.

## Secret rotation runbook

### Rotate DATABASE_URL (PostgreSQL password)

1. Open Railway dashboard > your project > PostgreSQL service.
2. Under **Variables**, note the current `PGPASSWORD`.
3. Railway-managed PostgreSQL credentials rotate via the **Reset Credentials** button in the database service settings. Click it.
4. Railway automatically updates `DATABASE_URL`, `PGPASSWORD`, and related variables across linked services.
5. Redeploy the API service: Railway dashboard > API service > **Redeploy**.
6. Verify: check API health endpoint returns `200 OK`.

```bash
curl -s https://YOUR_API_DOMAIN/health | jq .
```

### Rotate OPENAI_API_KEY

1. Go to https://platform.openai.com/api-keys.
2. Create a new key. Copy it.
3. In Railway dashboard > API service > **Variables**, update `OPENAI_API_KEY` with the new key.
4. Railway auto-redeploys on variable change. If not, trigger a manual redeploy.
5. Verify: send a chat message and confirm song matching works.
6. Delete the old key in the OpenAI dashboard.

### Rotate COOKIE_SECRET

1. Generate a new secret:
   ```bash
   openssl rand -hex 32
   ```
2. In Railway dashboard > API service > **Variables**, update `COOKIE_SECRET`.
3. Railway auto-redeploys. Existing user sessions will be invalidated (users get new anonymous handles). This is expected and harmless.
4. Verify: open the app, confirm you get a new handle and can send messages.

### Rotate REDIS_URL (Redis password)

Same process as DATABASE_URL — Railway manages Redis credentials. Use **Reset Credentials** on the Redis service, then redeploy.

## What to do if a secret leaks

**Immediate (do within minutes):**

1. **Rotate the leaked secret** using the runbook above. Do this first, before anything else.
2. **Revoke the old credential** at the source (OpenAI dashboard, Railway DB reset, etc.).
3. **Verify the app works** with the new credential.

**Assessment (do within hours):**

4. **Check for abuse.** Review Railway metrics, OpenAI usage dashboard, and database logs for unexpected activity during the exposure window.
5. **Determine scope.** Was it committed to git? Posted publicly? Only on a local machine?

**Cleanup (do within a day):**

6. **Remove from git history** (if committed). This is optional but recommended for public repos:
   ```bash
   # Install: pip install git-filter-repo
   git filter-repo --invert-paths --path <file-with-secret>
   git push --force --all
   ```
   **Tradeoffs of history rewrite:**
   - Pro: removes the secret from all clones going forward.
   - Con: force-push rewrites history; all contributors must re-clone. Existing forks/clones still have the old history.
   - If the repo is private and the secret has been rotated, history rewrite is lower priority.
   - If the repo is public, history rewrite is strongly recommended in addition to rotation.

7. **Document the incident.** Note what leaked, when, what was done, and any follow-up actions.

## Reporting vulnerabilities

If you discover a security issue, email the repository owner directly. Do not open a public issue.
