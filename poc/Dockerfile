# Dockerfile for the connector PoC backend.
#
# ONE image, THREE services in compose (api / worker / scheduler) — they all
# share this image and only differ in the `command:` they run inside. The
# entry point is `node_modules/.bin/ts-node src/main.ts <mode>`.
#
# Source code lives in a bind-mount in dev so editing on the host triggers
# a fresh ts-node compile on container restart — no rebuild needed for
# everyday work. Rebuilds are only required when:
#   - package.json / package-lock.json change   (npm ci re-runs)
#   - prisma/schema.prisma changes              (prisma generate re-runs)

FROM node:20-alpine

# Tools Prisma's openssl probe + native deps need on Alpine.
# (Alpine's musl + Prisma's prebuilt binaries — install openssl + libc6-compat
# so Prisma picks the right engine. tini for clean PID-1 signal handling.)
RUN apk add --no-cache openssl libc6-compat tini

WORKDIR /app

# 1. Install deps. Copy the lockfiles first so this layer caches when only
#    source files change.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# 2. Prisma client. Schema is needed at install time to generate the typed
#    client into node_modules/@prisma/client. We re-run on schema changes.
COPY prisma ./prisma
RUN npx prisma generate

# 3. Source + config. In dev these are bind-mounted over the image copy
#    (compose volume), so this COPY mostly serves the "production-style"
#    case where someone runs the image without a mount.
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src

# Default port (api). Worker/scheduler don't bind anything.
ENV NODE_ENV=production
EXPOSE 3000

# Use tini as PID 1 so SIGTERM propagates correctly to ts-node + Nest. That
# matters for the worker/scheduler — without it, BullMQ jobs in flight may
# get cut without the graceful shutdown hook running.
ENTRYPOINT ["/sbin/tini", "--"]

# Default to api; compose overrides for worker/scheduler.
CMD ["npx", "ts-node", "-r", "tsconfig-paths/register", "src/main.ts", "api"]
