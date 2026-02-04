# Musicr Documentation Index

Central index for all Musicr documentation.

## Getting Started

- **[README.md](../README.md)** - Project overview, setup instructions, and quick start guide
- **[.env.example](../.env.example)** - Complete environment variable reference

## Development

- **[CONTRIBUTING.md](../CONTRIBUTING.md)** - Development guidelines, workflow, and code style
- **[ARCHITECTURE.md](../ARCHITECTURE.md)** - System design and technical architecture

## Operations

- **[RUNBOOK.md](../RUNBOOK.md)** - Deployment and operational procedures
- **[REDIS_DEPLOYMENT.md](../REDIS_DEPLOYMENT.md)** - Redis setup for multi-instance deployments

## Diagnostics & Scaling

- **[SPLIT_BRAIN_TEST.md](../SPLIT_BRAIN_TEST.md)** - Instance coordination diagnostic procedures
- **[REDIS_DEPLOYMENT.md](../REDIS_DEPLOYMENT.md)** - Horizontal scaling with Redis pub/sub

## Testing

- **[Test Fixtures](../apps/api/fixtures/FIXTURES_README.md)** - Test fixture documentation

## Database

- **Schema:** [apps/api/prisma/schema.prisma](../apps/api/prisma/schema.prisma)
- **Migrations:** `apps/api/prisma/migrations/`
- **[CATALOG.md](../docs/CATALOG.md)** - Catalog management, validation, and safety guidelines

## Archived Documentation

- **[archive/](../docs/archive/)** - Deprecated/contaminated files (DO NOT USE)
  - `catalog_contaminated_DO_NOT_USE.csv` - Quarantined placeholder-heavy dataset
  - `DEPLOYMENT.md` - Legacy Docker Compose deployment
  - `PRODUCTION_DEPLOYMENT.md` - Multi-platform guide
  - `PHASE1-EXECUTION.md` - Database migration planning

## Quarantine

- **[quarantine/](../docs/quarantine/)** - Removed data for audit/reference
  - `catalog_placeholders.csv` - 4,405 placeholder songs with removal reasons
  - `catalog_clean_ALREADY_IN_SONGS_SEED.csv` - Clean extraction (already in production)
