# syntax=docker/dockerfile:1
# ─────────────────────────────────────────────────────────────
# 单容器多进程部署：Next.js Web（next start）+ RabbitMQ 审查消费者（worker）
# 两进程由 PM2（pm2-runtime 作为 PID 1）统一托管。
# 需运行时通过 -e / --env-file 注入：REDIS_URL、PR_MYSQL_URL、RABBITMQ_URL、
# JWT 相关密钥、模型 API Key 等（镜像内不写死任何密钥）。
#
# 网络：默认走 npmmirror（国内镜像），可通过 --build-arg NPM_REGISTRY / PRISMA_ENGINES_MIRROR 切换
#   docker build --build-arg NPM_REGISTRY=https://registry.npmjs.org ...
# ─────────────────────────────────────────────────────────────

# 1) 基础镜像：Node + pnpm（corepack），并配置镜像与网络超时
FROM node:22-alpine AS base
ARG NPM_REGISTRY=https://registry.npmmirror.com
ARG PRISMA_ENGINES_MIRROR=https://npmmirror.com/mirrors/prisma
# PNPM_HOME 单独一条 ENV，避免在同一条 ENV 内自引用导致 UndefinedVar
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH" \
    npm_config_registry="$NPM_REGISTRY" \
    COREPACK_NPM_REGISTRY="$NPM_REGISTRY" \
    PRISMA_ENGINES_MIRROR="$PRISMA_ENGINES_MIRROR" \
    npm_config_fetch_timeout="600000" \
    npm_config_fetch_retries="6" \
    npm_config_network_concurrency="8" \
    NEXT_TELEMETRY_DISABLED="1"
RUN corepack enable
WORKDIR /app

# 2) 依赖层：仅安装，不触发 postinstall（prisma schema 尚未就位）
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts

# 3) 构建层：复制源码 → 生成 Prisma Client → 构建 Next
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm exec prisma generate \
    && pnpm build

# 4) 运行层：含全部依赖（含 tsx，供 worker 直接执行 ts）+ nginx（负载均衡入口）
FROM base AS runner
ENV NODE_ENV="production"
COPY --from=build /app /app
# 安装 nginx（负载均衡 / 唯一对外入口）与 PM2
# 国内网络下 dl-cdn.alpinelinux.org 常 TLS 超时，先切到阿里云镜像源再安装
RUN sed -i 's#dl-cdn.alpinelinux.org#mirrors.aliyun.com#g' /etc/apk/repositories \
    && apk add --no-cache nginx \
    && npm install -g pm2@latest
# SSL 证书：https 终止（nginx 引用 /etc/nginx/ssl/）
COPY ssl /etc/nginx/ssl/

WORKDIR /app
EXPOSE 3000

# pm2-runtime 作为 PID 1 管理：nginx(3000) + next×3(3001/2/3) + worker
CMD ["pm2-runtime", "start", "ecosystem.config.cjs"]