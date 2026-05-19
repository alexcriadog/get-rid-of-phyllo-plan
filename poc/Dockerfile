# Dockerfile for the connector PoC backend.
#
# ONE image, THREE services in compose (api / worker / scheduler) — they all
# share this image and only differ in the `command:` they run inside.
#
# Two runtime modes:
#   • dev   — compose mounts ./src + overrides command to `ts-node src/main.ts`.
#             Hot-reload via bind-mount; image CMD is ignored.
#   • prod  — `tools/docker-compose.prod.yml` overrides command to
#             `node dist/main.js <mode>`. Runs the compiled JS from `dist/`
#             which this image builds at image-build time. ~4x less RAM than
#             ts-node (no in-memory TS compiler / AST).
#
# Rebuilds are required when:
#   - package.json / package-lock.json change   (npm ci re-runs)
#   - prisma/schema.prisma changes              (prisma generate re-runs)
#   - any src/** change in prod                 (npm run build re-runs)

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
# Operator scripts (issue-api-key, discover-ig, etc.) — invoked via
# `docker compose exec api npm run <script>`. Kept in the image so the
# legacy connect-tool/CLI flows work without bind-mounts in prod.
COPY scripts ./scripts

# 4. Compile TypeScript → dist/. Used in prod (node dist/main.js); ignored in
#    dev where compose overrides the command back to ts-node + bind-mount.
RUN npm run build

# Default port (api). Worker/scheduler don't bind anything.
ENV NODE_ENV=production
EXPOSE 3000

# Use tini as PID 1 so SIGTERM propagates correctly to Node + Nest. That
# matters for the worker/scheduler — without it, BullMQ jobs in flight may
# get cut without the graceful shutdown hook running.
ENTRYPOINT ["/sbin/tini", "--"]

# Default to api; compose overrides for worker/scheduler. Dev compose
# overrides this entirely to use ts-node against the bind-mounted src/.
# tsconfig.json includes prisma/seed.ts alongside src/**, so tsc preserves
# the directory structure and emits to dist/src/main.js (not dist/main.js).
CMD ["node", "dist/src/main.js", "api"]
