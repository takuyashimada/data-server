FROM node:24-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/receiver/package.json packages/receiver/package.json
COPY packages/viewer/package.json packages/viewer/package.json

RUN npm ci

COPY tsconfig.json tsconfig.base.json ./
COPY packages packages

RUN npm run build --workspace=@iot-data-server/shared
RUN npm run build
RUN npm prune --omit=dev

FROM node:24-slim

WORKDIR /app
ENV NODE_ENV=production
ENV IOT_DATA_SERVER_CONFIG_DIR=/app/config
ENV IOT_DATA_SERVER_DATA_DIR=/app/data

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/packages packages
COPY config config
COPY data/.gitkeep data/.gitkeep

EXPOSE 1883 8883 3000
VOLUME ["/app/config", "/app/data"]

CMD ["sh", "-c", "node packages/receiver/dist/main.js & node packages/viewer/dist/main.js & wait"]
