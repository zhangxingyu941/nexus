ARG NODE_IMAGE=node:20-alpine

FROM ${NODE_IMAGE} AS base
RUN npm install --global pnpm@10.12.1
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM deps AS builder
ARG NEXT_PUBLIC_COLLABORATION_URL=ws://localhost:1234
ENV NEXT_OUTPUT=standalone
ENV NEXT_PUBLIC_COLLABORATION_URL=$NEXT_PUBLIC_COLLABORATION_URL
COPY . .
RUN pnpm build

FROM deps AS migration
ENV NODE_ENV=production
COPY . .
USER node
CMD ["pnpm", "db:migrate"]

FROM deps AS collaboration
ENV NODE_ENV=production
COPY . .
USER node
EXPOSE 1234
CMD ["pnpm", "exec", "tsx", "scripts/collaboration-server.ts"]

FROM base AS runner
ENV HOSTNAME=0.0.0.0
ENV NODE_ENV=production
ENV PORT=3000
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
RUN mkdir -p server/data/uploads \
  && chown -R nextjs:nodejs server
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
