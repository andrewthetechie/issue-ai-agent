FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/lib ./lib

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["node", "lib/index.js"]
