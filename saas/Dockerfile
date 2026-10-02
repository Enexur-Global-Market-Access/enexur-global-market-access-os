FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm db:generate && pnpm build

FROM node:22-alpine AS runtime
RUN corepack enable && apk add --no-cache nginx
WORKDIR /app
COPY --from=build /app /app
COPY deploy/nginx.conf /etc/nginx/http.d/default.conf
EXPOSE 80 4100
