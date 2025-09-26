# Multi-stage Dockerfile for musicr API
# Optimized for production deployment with caching and security

# Stage 1: Dependencies and build preparation
FROM node:20-alpine AS dependencies
LABEL stage=dependencies

# Install system dependencies
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    postgresql-client \
    curl

# Set working directory
WORKDIR /app

# Copy package files for dependency installation
COPY package.json pnpm-lock.yaml ./
COPY apps/api/package.json ./apps/api/

# Install pnpm
RUN corepack enable pnpm

# Install dependencies with frozen lockfile
RUN pnpm install --frozen-lockfile --prod=false

# Stage 2: Build the application
FROM dependencies AS builder
LABEL stage=builder

# Copy source code
COPY apps/api ./apps/api
COPY packages ./packages
COPY prisma ./prisma
COPY tsconfig.json ./

# Set environment for build
ENV NODE_ENV=production

# Generate Prisma client
RUN cd apps/api && pnpm prisma generate

# Build the application
RUN cd apps/api && pnpm run build

# Stage 3: Production runtime
FROM node:20-alpine AS runtime
LABEL stage=runtime

# Install runtime system dependencies
RUN apk add --no-cache \
    postgresql-client \
    curl \
    dumb-init

# Create app user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S musicr -u 1001

# Set working directory
WORKDIR /app

# Copy package files
COPY --chown=musicr:nodejs package.json pnpm-lock.yaml ./
COPY --chown=musicr:nodejs apps/api/package.json ./apps/api/

# Install pnpm
RUN corepack enable pnpm

# Install only production dependencies
RUN pnpm install --frozen-lockfile --prod=true

# Copy built application and dependencies
COPY --from=builder --chown=musicr:nodejs /app/apps/api/dist ./apps/api/dist
COPY --from=builder --chown=musicr:nodejs /app/apps/api/node_modules/.prisma ./apps/api/node_modules/.prisma
COPY --from=builder --chown=musicr:nodejs /app/node_modules ./node_modules

# Copy prisma schema for runtime
COPY --chown=musicr:nodejs apps/api/prisma ./apps/api/prisma

# Copy scripts and configuration
COPY --chown=musicr:nodejs apps/api/scripts ./apps/api/scripts
COPY --chown=musicr:nodejs apps/api/fixtures ./apps/api/fixtures

# Create necessary directories
RUN mkdir -p /app/logs /app/tmp && \
    chown -R musicr:nodejs /app/logs /app/tmp

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:4000/health || exit 1

# Switch to non-root user
USER musicr

# Expose port
EXPOSE 4000

# Set environment variables
ENV NODE_ENV=production
ENV PORT=4000
ENV HOST=0.0.0.0

# Use dumb-init for proper signal handling
ENTRYPOINT ["dumb-init", "--"]

# Start command
CMD ["pnpm", "start"]