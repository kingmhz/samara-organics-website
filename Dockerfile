FROM node:22-bookworm-slim AS builder

WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
# sqlite3 is a native module. Compile it against the same Debian/glibc
# baseline used by the runtime image instead of trusting a newer prebuild.
RUN npm_config_build_from_source=true npm ci
COPY . .
RUN npm run build && npm test && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4173 \
    DATABASE_PATH=/data/samara.db

WORKDIR /app
COPY --from=builder --chown=node:node /app /app
RUN mkdir -p /data && chown node:node /data

USER node
EXPOSE 4173
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4173/api/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
