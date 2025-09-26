# Multi-stage Dockerfile for musicr Web Frontend
# Optimized for production deployment with Vite preview mode

# Stage 1: Dependencies
FROM node:20-alpine AS dependencies
LABEL stage=dependencies

# Install system dependencies
RUN apk add --no-cache \
    python3 \
    make \
    g++

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml ./
COPY apps/web/package.json ./apps/web/

# Install pnpm
RUN corepack enable pnpm

# Install dependencies
RUN pnpm install --frozen-lockfile --prod=false

# Stage 2: Build the application
FROM dependencies AS builder
LABEL stage=builder

# Copy source code
COPY apps/web ./apps/web
COPY tsconfig.json ./

# Set environment for build
ENV NODE_ENV=production
ENV VITE_API_URL=http://localhost:4000

# Build the application
RUN cd apps/web && pnpm run build

# Stage 3: Production runtime with Vite preview
FROM node:20-alpine AS runtime
LABEL stage=runtime

# Install runtime dependencies
RUN apk add --no-cache \
    curl \
    dumb-init

# Create app user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S musicr -u 1001

# Set working directory
WORKDIR /app

# Copy package files
COPY --chown=musicr:nodejs package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN mkdir -p apps/web
COPY --chown=musicr:nodejs apps/web/package.json ./apps/web/package.json

# Install pnpm
RUN corepack enable pnpm

# Install only production dependencies plus vite for preview
RUN pnpm install --frozen-lockfile --prod=true && \
    cd apps/web && pnpm add vite@^5.0.0 --prod=false

# Copy built application
COPY --from=builder --chown=musicr:nodejs /app/apps/web/dist ./apps/web/dist
COPY --from=builder --chown=musicr:nodejs /app/apps/web/vite.config.ts ./apps/web/
COPY --from=builder --chown=musicr:nodejs /app/apps/web/index.html ./apps/web/

# Health check for web service
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD ["sh", "-c", "curl -f http://localhost:${PORT:-5173}/ || exit 1"]

# Switch to non-root user
USER musicr

# Expose default preview port
EXPOSE 5173

# Set environment variables
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=5173

# Use dumb-init for proper signal handling
ENTRYPOINT ["dumb-init", "--"]

# Start with Vite preview mode, respecting Railway-provided PORT
CMD ["sh", "-c", "cd apps/web && pnpm vite preview --host 0.0.0.0 --port ${PORT:-5173}"]