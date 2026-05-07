# poc/web — Next.js admin dashboard. Multi-stage build mirrors connect-tool.
# Output: standalone server on port 3001.

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
ARG NEXT_PUBLIC_CONNECTOR_API_URL
ENV NEXT_PUBLIC_CONNECTOR_API_URL=${NEXT_PUBLIC_CONNECTOR_API_URL}
ARG NEXT_PUBLIC_CONNECT_TOOL_URL
ENV NEXT_PUBLIC_CONNECT_TOOL_URL=${NEXT_PUBLIC_CONNECT_TOOL_URL}
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN node -e "const c=require('./next.config.js'); c.output='standalone'; require('fs').writeFileSync('./next.config.runtime.js','module.exports='+JSON.stringify(c)+';');" \
 && cp next.config.runtime.js next.config.js \
 && npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001
ENV HOSTNAME=0.0.0.0
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3001
CMD ["node", "server.js"]
