# Build stage: needs devDependencies (vite, typescript) to run the Remix build.
# The single-stage template Dockerfile ran `npm ci --omit=dev` and then
# `npm run build`, which cannot work — `remix vite:build` needs vite, and vite
# is a devDependency.
FROM node:22-alpine AS build

RUN apk add --no-cache openssl
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
RUN npx prisma generate && npm run build

# Runtime stage: production dependencies only, and the built output.
FROM node:22-alpine AS runtime

# openssl is required by Prisma's query engine.
RUN apk add --no-cache openssl
WORKDIR /app

ENV NODE_ENV=production
EXPOSE 3000

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force
# The Shopify CLI is a dev tool and has no place in a production image.
RUN npm remove @shopify/cli || true

COPY --from=build /app/build ./build
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma
COPY prisma ./prisma
COPY public ./public

# Don't run as root.
RUN addgroup -S app && adduser -S app -G app && chown -R app:app /app
USER app

# `docker-start` runs `prisma migrate deploy` before serving, so a new revision
# applies migrations on boot.
CMD ["npm", "run", "docker-start"]
