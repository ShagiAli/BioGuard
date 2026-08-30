# Single-image deployment: builds the frontend, builds the API, and
# serves both from one origin. One origin means the session cookie stays
# first-party, which SameSite=Strict requires — splitting the frontend
# onto a separate domain would make the browser drop it silently.

FROM node:22-alpine AS web
WORKDIR /web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM node:22-alpine AS api
WORKDIR /api
COPY server/package*.json ./
RUN npm ci
COPY server/prisma ./prisma
RUN npx prisma generate
COPY server/tsconfig.json server/tsconfig.build.json ./
COPY server/src ./src
RUN npm run build
RUN test -f dist/src/index.js || (echo "build produced no entry point" && exit 1)

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV SERVE_WEB=true

COPY server/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=api /api/node_modules/.prisma ./node_modules/.prisma
COPY --from=api /api/node_modules/@prisma ./node_modules/@prisma
COPY --from=api /api/dist ./dist
COPY server/prisma ./prisma
COPY --from=web /web/dist ./public

USER node
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://localhost:4000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/index.js"]
