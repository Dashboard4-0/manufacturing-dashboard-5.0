# Build stage
FROM --platform=$BUILDPLATFORM node:20-alpine AS builder

WORKDIR /app

# Copy workspace files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY tsconfig.base.json tsconfig.package.json ./

# Copy shared libs
COPY libs/shared ./libs/shared

# Copy service
COPY services/ms5.0-gateway ./services/ms5.0-gateway

# Install dependencies
RUN corepack enable && corepack prepare pnpm@8.15.5 --activate
RUN pnpm install --frozen-lockfile

# Build shared libs first
WORKDIR /app/libs/shared
RUN pnpm build

# Build service
WORKDIR /app/services/ms5.0-gateway
RUN pnpm prisma generate
RUN pnpm build

# Production stage
FROM --platform=$TARGETPLATFORM node:20-alpine

RUN apk add --no-cache tini curl

WORKDIR /app

# Copy built application
COPY --from=builder /app/services/ms5.0-gateway/dist ./dist
COPY --from=builder /app/services/ms5.0-gateway/package.json ./
COPY --from=builder /app/services/ms5.0-gateway/prisma ./prisma
COPY --from=builder /app/node_modules/.pnpm ./node_modules/.pnpm
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/services/ms5.0-gateway/node_modules ./node_modules
COPY --from=builder /app/libs/shared/dist ./node_modules/@ms5/shared/dist
COPY --from=builder /app/libs/shared/package.json ./node_modules/@ms5/shared/

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

USER nodejs

EXPOSE 3000

ENV NODE_ENV=production
ENV SERVICE_NAME=ms5-gateway

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]