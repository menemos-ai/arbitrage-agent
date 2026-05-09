# Stage 1: build TypeScript → JS
FROM node:22-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# Stage 2: production image
FROM node:22-alpine AS runner
WORKDIR /app

# Install production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev

# Copy compiled output from builder
COPY --from=builder /app/dist ./dist

# Non-root user for security
RUN addgroup -S agent && adduser -S agent -G agent
USER agent

ENV NODE_ENV=production

CMD ["node", "dist/src/index.js"]
