FROM node:25-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM deps AS build
COPY . .
RUN npm run build

FROM node:25-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY src ./src
COPY migrations ./migrations
COPY scripts/reindex-retrieval.mjs ./scripts/reindex-retrieval.mjs
COPY scripts/migrate-postgres.mjs ./scripts/migrate-postgres.mjs
COPY scripts/promote-real-catalog-postgres.mjs ./scripts/promote-real-catalog-postgres.mjs
COPY scripts/import-catalog-introductions-postgres.mjs ./scripts/import-catalog-introductions-postgres.mjs
COPY scripts/import-chain-menu-release-postgres.mjs ./scripts/import-chain-menu-release-postgres.mjs
COPY scripts/bootstrap-admin.mjs ./scripts/bootstrap-admin.mjs
COPY data/chain-menu-release-2026-08-08.json ./data/chain-menu-release-2026-08-08.json
COPY data/health-knowledge-bases ./knowledge/health-knowledge-bases
COPY data/campus-dining-knowledge ./data/campus-dining-knowledge
COPY --from=build /app/dist ./dist
EXPOSE 8787
CMD ["node", "server/index.js"]
