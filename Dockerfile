# syntax=docker/dockerfile:1
# Notey for Node / Docker: one container, SQLite and files in the /data volume.

FROM node:22-bookworm-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build:web && pnpm build:node
# The server bundle inlines everything except libSQL (native bindings), so the
# runtime only needs that one package, pinned to the lockfile's version.
RUN mkdir /runtime && node -e "const fs=require('fs');const v=require('./node_modules/@libsql/client/package.json').version;fs.writeFileSync('/runtime/package.json',JSON.stringify({private:true,type:'module',dependencies:{'@libsql/client':v}}))"

FROM node:22-bookworm-slim AS deps
WORKDIR /runtime
COPY --from=build /runtime/package.json ./
RUN npm install --omit=dev --no-audit --no-fund

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data WEB_DIR=/app/dist/web
COPY --from=deps /runtime/node_modules ./node_modules
COPY --from=deps /runtime/package.json ./package.json
COPY --from=build /app/dist/web ./dist/web
COPY --from=build /app/dist/server ./dist/server
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server/node.mjs"]
