# Multi-stage Dockerfile for musicr Web Frontend
# Designed to work with Railway's apps/web/** watch path
# Railway should provide only apps/web content as build context

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

    # Copy package files - Railway context is apps/web only
    COPY package.json ./
    
    # Install pnpm
    RUN corepack enable pnpm
    
    # Install dependencies without pnpm-lock.yaml (Railway apps/web context limitation)
    # Install all dependencies including dev deps for build stage
    RUN pnpm install

# Stage 2: Build the application
FROM dependencies AS builder
LABEL stage=builder

# Copy web source code (should be root of build context)
COPY . ./

# Set environment for build
ENV NODE_ENV=production
# Use Railway's internal service URL for API communication
# Railway will override this with VITE_API_URL environment variable if set
ENV VITE_API_URL=${VITE_API_URL:-http://localhost:4000}

# Build the application
RUN pnpm run build

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

# Copy web package.json for runtime dependencies
COPY --from=builder --chown=musicr:nodejs /app/package.json ./

# Install pnpm
RUN corepack enable pnpm

# Install only production dependencies 
# Note: No pnpm-lock.yaml in runtime stage, so can't use --frozen-lockfile
RUN pnpm install --prod=true

# Copy built application and config files
COPY --from=builder --chown=musicr:nodejs /app/dist ./dist
COPY --from=builder --chown=musicr:nodejs /app/index.html ./

# Switch to non-root user BEFORE setting up files to avoid permission issues
USER musicr

# Create a writable cache directory for Vite
RUN mkdir -p /tmp/vite-cache && chmod 755 /tmp/vite-cache

# Health check for web service
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD ["sh", "-c", "curl -f http://localhost:${PORT:-5173}/ || exit 1"]

# Expose default preview port
EXPOSE 5173

# Set environment variables
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=5173

# Use dumb-init for proper signal handling
ENTRYPOINT ["dumb-init", "--"]

# Use serve (simple static file server) instead of vite preview to avoid permission issues
# serve is more reliable for production static file serving
# The preview script in package.json now uses serve
CMD ["pnpm", "run", "preview"]