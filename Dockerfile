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
COPY data/health-knowledge-bases ./knowledge/health-knowledge-bases
COPY --from=build /app/dist ./dist
EXPOSE 8787
CMD ["node", "server/index.js"]
