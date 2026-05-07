# connect-tool — TRANSIENT OAuth helper. Multi-stage build that produces a
# minimal Next.js standalone image. Same Node base as poc/.

FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund

FROM node:20-alpine AS builder
WORKDIR /app
# `NEXT_PUBLIC_*` env vars are inlined into the client bundle at build
# time. Compose's `environment:` only applies at runtime — too late for
# Next.js. Accept them as build args here, exported so `next build` sees
# them.
ARG NEXT_PUBLIC_POC_ADMIN_URL
ENV NEXT_PUBLIC_POC_ADMIN_URL=${NEXT_PUBLIC_POC_ADMIN_URL}
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Force assetPrefix='/connect' so Next emits /_next/* requests under
# /connect/_next/*. Avoids a path collision with the POC web image
# (which also serves /_next/*) when both sit behind the same Caddy.
# Page paths (/, /facebook/*, /confirm/*, /success) stay where they are
# since none of them start with /connect.
RUN node -e "const c=require('./next.config.js'); c.assetPrefix='/connect'; require('fs').writeFileSync('./next.config.runtime.js','module.exports='+JSON.stringify(c)+';');" \
 && cp next.config.runtime.js next.config.js \
 && npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3002
ENV HOSTNAME=0.0.0.0
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3002
CMD ["node", "server.js"]
