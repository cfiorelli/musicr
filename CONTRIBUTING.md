# Contributing to Musicr

Thank you for your interest in contributing to Musicr! This guide will help you get started with development.

## Development Setup

### Prerequisites

- Node.js 20+
- pnpm 8+
- PostgreSQL 14+ with pgvector extension
- Git

### Initial Setup

1. Fork and clone the repository
   ```bash
   git clone https://github.com/your-username/musicr.git
   cd musicr
   ```

2. Install dependencies
   ```bash
   pnpm install
   ```

3. Set up environment
   ```bash
   cp .env.example .env
   # Edit .env with your local DATABASE_URL
   ```

4. Set up database
   ```bash
   cd apps/api
   pnpm prisma generate
   pnpm prisma migrate deploy
   pnpm seed
   ```

5. Start development servers
   ```bash
   # From root directory
   pnpm dev
   ```

## Project Structure

```
musicr/
├── apps/
│   ├── api/          # Fastify backend
│   │   ├── src/
│   │   │   ├── engine/      # Song matching algorithms
│   │   │   ├── services/    # Core services (DB, WebSocket, etc.)
│   │   │   ├── embeddings/  # Embedding generation
│   │   │   └── config/      # Configuration and env vars
│   │   ├── prisma/          # Database schema and migrations
│   │   └── scripts/         # Utility scripts (seeding, etc.)
│   └── web/          # React frontend
│       └── src/
│           ├── components/  # React components
│           ├── stores/      # Zustand state management
│           └── utils/       # Utility functions
├── shared/
│   └── types/        # Shared TypeScript types
└── docs/             # Documentation
```

## Development Workflow

### Branch Strategy

- `main` - Production branch, auto-deploys to Railway
- `feature/*` - New features
- `fix/*` - Bug fixes
- `docs/*` - Documentation updates

### Making Changes

1. Create a feature branch
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. Make your changes
   - Write clear, focused commits
   - Follow the code style (see below)
   - Add tests for new functionality

3. Test locally
   ```bash
   # Run linter
   pnpm lint

   # Run tests
   pnpm test

   # Test builds
   pnpm build
   ```

4. Commit your changes
   ```bash
   git add .
   git commit -m "feat: add new feature description"
   ```

5. Push and create a pull request
   ```bash
   git push origin feature/your-feature-name
   ```

### Commit Messages

Follow conventional commits format:

- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation changes
- `style:` - Code style changes (formatting, etc.)
- `refactor:` - Code refactoring
- `test:` - Test additions or changes
- `chore:` - Build process or tooling changes

Examples:
```
feat: add emoji reactions to messages
fix: prevent WebSocket connection drops
docs: update deployment instructions
refactor: simplify semantic search query
```

## Code Style

### TypeScript

- Use TypeScript strict mode
- Avoid `any` types - use `unknown` or proper types
- Prefer interfaces over type aliases for object shapes
- Use Zod for runtime validation at API boundaries

### Formatting

- Run `pnpm lint` before committing
- 2-space indentation
- Use single quotes for strings
- No semicolons (ESLint will auto-fix)

### Naming Conventions

- **Files:** kebab-case (`user-service.ts`, `chat-interface.tsx`)
- **Components:** PascalCase (`ChatInterface`, `RoomUserList`)
- **Functions:** camelCase (`getUserByHandle`, `findSimilarSongs`)
- **Constants:** UPPER_SNAKE_CASE (`MAX_MESSAGE_LENGTH`, `DEFAULT_ROOM_ID`)

## Testing

### Running Tests

```bash
# All tests
pnpm test

# Watch mode
pnpm test --watch

# Specific package
pnpm --filter @musicr/api test
```

### Writing Tests

- Place tests next to the code they test (`*.test.ts` or `*.spec.ts`)
- Use descriptive test names
- Test edge cases and error conditions
- Mock external dependencies (database, OpenAI, etc.)

Example:
```typescript
describe('SemanticSearcher', () => {
  it('should return songs sorted by similarity', async () => {
    // Test implementation
  });

  it('should handle empty query gracefully', async () => {
    // Test implementation
  });
});
```

## Database Migrations

### Creating a Migration

1. Update `apps/api/prisma/schema.prisma`
2. Generate migration
   ```bash
   cd apps/api
   pnpm prisma migrate dev --name describe_your_change
   ```
3. Review generated SQL in `prisma/migrations/`
4. Test migration on local database
5. Commit both schema.prisma and migration files

**Important:** Always commit migration files. They're version-controlled and required for deployments.

### Migration Best Practices

- Never edit existing migrations - create new ones
- Test migrations on production-like data
- Include both `up` and `down` logic
- Document breaking changes in PR description

## Adding Dependencies

```bash
# Add to workspace root
pnpm add <package-name> -w

# Add to specific package
pnpm --filter @musicr/api add <package-name>
pnpm --filter @musicr/web add <package-name>

# Add dev dependency
pnpm add -D <package-name>
```

## Common Tasks

### Adding a New Song Matcher

1. Create matcher in `apps/api/src/engine/matchers/`
2. Implement `MatcherInterface`
3. Register in `apps/api/src/engine/pipeline.ts`
4. Add tests in `__tests__/` directory
5. Update ARCHITECTURE.md with matcher description

### Adding a New WebSocket Event

1. Define message type in `apps/api/src/index.ts`
2. Add handler in WebSocket message switch
3. Update frontend in `apps/web/src/stores/chatStore.ts`
4. Test with `/test` page or real chat

### Adding a New API Endpoint

1. Add route in `apps/api/src/index.ts`
2. Define request/response schemas with Zod
3. Implement handler function
4. Update README.md API Endpoints section
5. Test with curl or Postman

## Debugging

### API Debugging

```bash
# Enable debug logging
LOG_LEVEL=debug pnpm --filter @musicr/api dev

# Check database queries
DEBUG=prisma:* pnpm --filter @musicr/api dev

# Enable debug matching (shows embedding details)
DEBUG_MATCHING=1 pnpm --filter @musicr/api dev
```

### Frontend Debugging

- Use React DevTools browser extension
- Check Zustand state in browser console: `window.chatStore`
- Monitor WebSocket in Network tab (WS filter)

### Database Debugging

```bash
# Open Prisma Studio
cd apps/api
pnpm db:studio

# Connect to database directly
psql $DATABASE_URL

# View migrations status
pnpm prisma migrate status
```

## Pull Request Process

1. **Update documentation** - If your change affects usage, update README.md or relevant docs
2. **Add tests** - New features should include test coverage
3. **Check builds** - Ensure `pnpm build` succeeds
4. **Write clear PR description:**
   - What changed
   - Why it changed
   - How to test it
   - Screenshots (for UI changes)
5. **Link related issues** - Use "Fixes #123" in PR description
6. **Request review** - Tag relevant maintainers
7. **Address feedback** - Make requested changes or discuss concerns

### PR Checklist

- [ ] Code follows project style guidelines
- [ ] Tests added for new functionality
- [ ] Documentation updated (README, ARCHITECTURE, etc.)
- [ ] Migrations tested (if applicable)
- [ ] `pnpm lint` passes
- [ ] `pnpm build` succeeds
- [ ] Changes tested locally
- [ ] Commit messages follow conventional commits
- [ ] No sensitive data (API keys, passwords) committed

## Getting Help

- **Questions:** Open a GitHub Discussion
- **Bugs:** Open a GitHub Issue with reproduction steps
- **Security:** Email security@musicr.app (do not open public issue)

## Code of Conduct

- Be respectful and inclusive
- Focus on constructive feedback
- Assume good intentions
- Help create a welcoming environment for all contributors

## License

By contributing to Musicr, you agree that your contributions will be licensed under the MIT License.
