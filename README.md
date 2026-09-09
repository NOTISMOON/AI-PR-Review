# AI PR Review（ReviewForge）

> 🎯 **路演项目 v2.0** - 基于 AI 的智能代码审查平台。支持 GitHub / Gitee 双平台账号登录，在 PR 出现的那一刻自动触发 AI 结构化审查，并提供审查处理中心完成人工决策闭环。

[![Next.js](https://img.shields.io/badge/Next.js-15+-black)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-latest-blue)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-4.1.12-38bdf8)](https://tailwindcss.com/)
[![MySQL](https://img.shields.io/badge/MySQL-8+-4479a1)](https://www.mysql.com/)
[![Redis](https://img.shields.io/badge/Redis-7+-dc382d)](https://redis.io/)
[![LangGraph](https://img.shields.io/badge/LangGraph-1.4.x-1c3c3c)](https://www.langchain.com/langgraph)

## ✨ 核心特性

### 🔑 双平台登录（GitHub / Gitee）

- 使用 GitHub 或 Gitee 账号 **OAuth 一键登录**，两平台数据完全隔离，互不聚合

- **JWT 双 token 认证**：access token（15 分钟）+ refresh token（7 天），HttpOnly Cookie 存储，临近过期自动刷新

- refresh token 存储于 **Redis**（未配置时降级为进程内存）

- GitHub App 机器人身份：审查完成后可自动回写 Review / 评论

### 🎯 三级审查深度

- **快速扫描（fast）**：仅检查 diff 内直接可见的问题（语法、类型、明显安全漏洞）

- **标准审查（standard）**：结合周边代码与依赖关系的逻辑分析（默认）

- **深度审查（deep）**：跨模块依赖分析、性能热点、架构与可维护性评估

### 🧠 LangGraph 多维度并行审查流水线

基于 **LangGraph StateGraph** 编排的审查流程：

```
PR → prepare（上下文收集 + 模型选择）
   → [bug | security | performance | quality] 四维度并行审查
   → merge（汇总风险评级 / 生成摘要）
   → validate（JSON Schema + 质量 + 一致性校验）
   → generate（回写 GitHub Review / 落库 / 站内通知 + SSE 实时推送）
```

- 四个维度并行分析，独立输出问题与建议，互不干扰

- 结构化输出 + 多重校验兜底，降低 AI 幻觉导致的脏数据

### 🔄 审查处理中心（/review）

- Webhook 触发的自动审查完成后，进入待处理队列（侧边栏实时角标 + 实时通知）

- 支持**人工决策闭环**：批准（Approve）/ 请求变更（Request Changes）/ 评论 / 采纳建议（回写 GitHub 评论）/ 忽略 / 关闭 PR

- 决策结果实时回写 GitHub，失败时透传真实状态码与错误信息

- 二次审查模式：基于已有分析结果迭代验证、补充、修正

### 🔔 Webhook 自动审查

- GitHub / Gitee 双平台 Webhook 端点，支持签名校验、幂等去重、事件日志

- PR `opened` / `synchronize` 事件**自动触发**审查（fire-and-forget）

- 任务发布到 **RabbitMQ 队列**（review\_jobs），独立 worker 消费执行；队列不可用时自动降级为直接执行

- 失败自动重试（最多 3 次，指数退避）

- 支持按仓库开关自动审查（`repo_auto_review` 设置）

### 📊 数据洞察

- **贡献热力图**：Last 12 months / 当年，GitHub 使用官方 GraphQL `contributionsCollection`

- **控制台仪表盘**：KPI 卡片（年内提交 / 仓库数 / 待审 PR / 问题检出率）、语言分布、仓库排行、待审队列

- 贡献数据持久化到 MySQL `contribution_summary`，Redis 缓存 30 分钟

### 🔔 实时通知

- 站内通知中心（未读角标 + 全部已读 + 单条查看/删除 + 右键菜单）

- **SSE 实时推送**：跨多实例经 Redis Pub/Sub 广播，新审查完成即时 toast 提醒

### 📦 数据持久化与缓存

- 业务数据统一存入 **MySQL**（9 张表，Drizzle ORM 类型安全访问，表结构运行时幂等创建）

- **Redis** 承担三层职责：缓存（Cache Aside + 分布式锁）、refresh token、通知广播

- 审查结果（job + issues）落库，支持历史回看与重新审查

### 🔧 灵活的模型配置

- 内置提供商：**OpenAI / DeepSeek / Anthropic / 自定义 OpenAI 兼容接口**（含 Ollama、LM Studio 本地模型）

- 模型路由器：按 PR 语言、安全敏感路径、PR 规模自动择模型，也可在全局设置中手动指定

- 全局设置：风险阈值（宽松/默认/严格）、采样温度、最大评论数、diff\_only、自动回写 Review、提交状态检查等

## 🚀 快速启动

### 前置要求

- **Node.js** 18+（Docker 部署使用 node:22）

- **pnpm** 8+

- **MySQL** 8+：业务库（必需）

- **Redis** 7+：缓存 / refresh token / 通知广播（可选，未配置自动降级）

- **RabbitMQ**：审查任务队列（可选，未配置自动降级为直接执行）

### 本机启动

```bash
# 1. 克隆项目
git clone https://github.com/NOTISMOON/AI-PR-Review.git
cd AI-PR-Review

# 2. 安装依赖（务必使用 pnpm，混用 npm 会导致 Turbopack 模块解析失败）
pnpm install

# 3. 配置环境变量
# 创建 .env，参考 .env.example 填写：
PR_MYSQL_URL="mysql://root:pass@127.0.0.1:3306/prreview_db"

# 认证（双平台 OAuth 凭证，不配置则无法登录）
AUTH_JWT_SECRET="随机字符串"
GITHUB_CLIENT_ID=          GITHUB_CLIENT_SECRET=          GITHUB_REDIRECT_URI=
GITEE_CLIENT_ID=           GITEE_CLIENT_SECRET=           GITEE_REDIRECT_URI=

# GitHub App（机器人身份，用于自动回写 Review / 关闭 PR，可后配）
GITHUB_APP_ID=
GITHUB_APP_CLIENT_ID=      GITHUB_APP_CLIENT_SECRET=
GITHUB_APP_PRIVATE_KEY_PATH="/path/to/pem"   # 或 GITHUB_APP_PRIVATE_KEY 内联 PEM

# 基础设施（可选）
REDIS_URL="redis://localhost:6379"
RABBITMQ_URL="amqp://guest:guest@localhost:5672"

# AI 模型 API Key（按需配置，未配置的模型不可用）
OPENAI_API_KEY=
DEEPSEEK_API_KEY=
ANTHROPIC_API_KEY=

# 4. 启动开发服务器
pnpm dev
```

访问 <http://localhost:3000> 即可开始使用。

## 📖 使用指南

### 基本流程

1. **登录**：选择 GitHub 或 Gitee 账号 OAuth 登录
2. **查看数据**：控制台查看贡献热力图与仓库/审查统计
3. **浏览代码**：仓库列表 → 在线代码浏览，全局搜索仓库 / PR
4. **配置 Webhook**：在 Webhook 页创建订阅，PR 打开/更新即自动审查
5. **处理审查**：在「待审 PR」处理中心对自动审查结果做出决策
6. **查看历史**：审查历史中回看、复用二次审查

### 审查处理中心

自动审查完成后，可对每条结果执行：

| 操作        | 说明                            |
| --------- | ----------------------------- |
| 批准 / 请求变更 | 以登录身份向 GitHub 提交 PR Review 事件 |
| 采纳建议      | 将 AI 建议作为评论回写到 PR 讨论          |
| 忽略        | 标记为已处理，不对外操作                  |
| 关闭 PR     | 直接关闭该 PR                      |

## 🎨 技术栈

### 前端

| 技术                      | 用途                               |
| ----------------------- | -------------------------------- |
| Next.js 15+（App Router） | 全栈框架                             |
| React / TypeScript      | UI 与类型安全                         |
| Tailwind CSS 4.1.12     | 样式                               |
| shadcn/ui + Radix UI    | 无障碍 UI 组件库                       |
| MUI 7.3.5               | 组件补充                             |
| GSAP + @gsap/react      | 交互动画（含 split/flip/scrolltrigger） |
| Motion 12.x             | 动画库                              |
| Lucide Icons            | 图标                               |

### 后端 & 基础设施

| 技术                          | 用途                        |
| --------------------------- | ------------------------- |
| Next.js API Routes          | RESTful 接口                |
| LangChain / LangGraph 1.4.x | 审查编排流水线                   |
| Drizzle ORM 0.45.x + mysql2 | 类型安全数据库访问                 |
| MySQL 8+                    | 统一业务库（9 张表）               |
| Redis 7+（ioredis）           | 缓存 / refresh token / 通知广播 |
| RabbitMQ（amqplib）           | 审查任务队列                    |
| jose                        | JWT 双 token 认证            |
| PM2 + nginx                 | 生产多进程编排与负载均衡              |

### AI 集成

| 提供商       | SDK                    | 模型                                       |
| --------- | ---------------------- | ---------------------------------------- |
| OpenAI    | openai\@6.39.1         | GPT-4o, GPT-4o-mini                      |
| DeepSeek  | openai\@6.39.1         | DeepSeek Chat (V3)                       |
| Anthropic | 原生 Messages API（fetch） | Claude Haiku 4.5 / Sonnet 4.6 / Opus 4.8 |
| 自定义       | openai\@6.39.1         | 任意 OpenAI 兼容 API（含 Ollama、LM Studio）     |

## 🧠 系统设计思路

### 1. LangGraph 审查编排

```
prepare（收集上下文 + 路由模型）
  → 并行维度审查（bug / security / performance / quality）
  → merge（汇总 summary + riskLevel + 风险去重）
  → validate（Schema / quality / consistency 校验）
  → generate（回写 GitHub / 落库 / 通知广播）
```

### 2. 模型路由策略

- 按文件后缀检测主语言、按路径关键词识别安全敏感模块、按 PR 规模选择 tier（fast / primary / quality）

- 用户偏好优先：全局设置中选择的 provider/model 优先于自动路由

### 3. 智能上下文收集

按审查深度分级收集：diff → 周边函数定义 / 依赖图 / 配置文件 → 相关文件（AI 语义检索）/ PR 评论 / 完整文件

### 4. 提示词系统

- 基础系统提示词 + 各模式专用指令 + CoT 推理 + Few-shot 示例 + 语言特定规则

- **疑罪从无**：上下文不足时降低风险评级

- **功能变更识别**：区分代码缺陷与产品决策，不计入风险评级

### 5. Webhook → 队列 → 审查

- 验签（GitHub `X-Hub-Signature-256`）→ 幂等去重 → 写事件日志 → 发布 RabbitMQ 队列

- worker 消费时从 MySQL 现取平台 token（token 不进队列），失败指数退避重试

- RabbitMQ 不可用 → 降级为请求内直接执行

## 🔧 可用脚本

```bash
pnpm dev              # 启动开发服务器
pnpm build            # 构建生产版本
pnpm start            # 启动生产服务器
pnpm start:prod       # 以 0.0.0.0 启动（容器内使用）
pnpm lint             # 代码检查
pnpm review-worker    # 启动审查消费者进程（消费 RabbitMQ 队列）
```

## 🤝 贡献指南

欢迎提交 Issue 和 Pull Request！

1. Fork 本仓库
2. 创建特性分支：`git checkout -b feature/amazing-feature`
3. 提交更改：`git commit -m 'feat: add amazing feature'`
4. 推送到分支：`git push origin feature/amazing-feature`
5. 提交 Pull Request

### Commit 规范

使用 [Conventional Commits](https://www.conventionalcommits.org/) 规范：`feat` / `fix` / `docs` / `style` / `refactor` / `perf` / `test` / `chore`。

## 📮 联系方式

如有问题或建议，欢迎通过以下方式联系：

- 提交 [Issue](https://github.com/NOTISMOON/AI-PR-Review/issues)

- 发送邮件至：<xya0526c@gmail.com>

