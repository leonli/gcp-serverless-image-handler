FROM node:20-slim AS builder
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm ci
COPY tsconfig*.json ./
COPY src/ ./src/
RUN npm run build

FROM node:20-slim AS production
WORKDIR /usr/src/app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --only=production
COPY --from=builder /usr/src/app/dist ./dist
EXPOSE 8080
CMD ["node", "dist/index.js"]
