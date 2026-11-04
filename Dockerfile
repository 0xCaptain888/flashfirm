FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY src ./src
COPY scripts ./scripts
COPY web ./web
COPY artifacts ./artifacts
COPY evidence ./evidence
RUN npm run build:wallet && npm prune --omit=dev

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/web ./web
COPY --from=build /app/src ./src
COPY --from=build /app/evidence ./evidence
COPY --from=build /app/node_modules ./node_modules
COPY cloudflare/migrations ./cloudflare/migrations
COPY tee/phala-worker.mjs ./tee/phala-worker.mjs
COPY server.mjs package.json ./
COPY scripts/operator-token.mjs scripts/backup.mjs ./scripts/
COPY scripts/human-review.mjs scripts/prepare-native-settlement.mjs scripts/run-confidential-inference.mjs scripts/run-confidential-team.mjs ./scripts/
RUN mkdir /data && chown node:node /data
USER node
ENV PORT=43180 FLASHFIRM_BIND=0.0.0.0 FLASHFIRM_RUNTIME=/data
EXPOSE 43180
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node -e "require('node:http').get('http://127.0.0.1:43180/healthz',{headers:{host:new URL(process.env.FLASHFIRM_PUBLIC_ORIGIN).host}},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
CMD ["node","server.mjs"]
