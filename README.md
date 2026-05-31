# AI Code Review Tool

> 🎯 **路演项目** - 基于 AI 的智能代码审查工具，支持对 GitHub Pull Request 进行多层次、多维度的自动化代码审查

[![Next.js](https://img.shields.io/badge/Next.js-16.2.6-black)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-latest-blue)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-4.1.12-38bdf8)](https://tailwindcss.com/)
[![Prisma](https://img.shields.io/badge/Prisma-7.8.0-2d3748)](https://www.prisma.io/)

## 📹 项目演示

**演示视频：** [点击观看项目运行演示](https://your-video-link.com)
**项目上线地址：**https://ai-pr-review-eta.vercel.app/

> 视频展示了完整的代码审查流程，包括三种分析模式的对比、风险识别、智能建议等核心功能

## ✨ 核心特性

### 🎯 三级分析模式

- **轻度模式（Fast）**：快速扫描，仅检查 diff 内直接可见的问题
  - 语法错误、类型错误
  - 明显的安全漏洞（SQL 注入、硬编码密钥）
  - 明显的运行时错误
  - 适用场景：快速预检、小型 PR

- **中度模式（Standard）**：结合上下文的逻辑分析
  - 包含轻度模式的所有检查
  - 逻辑自洽性分析
  - 异常处理完整性
  - 函数签名兼容性
  - 适用场景：日常 PR 审查

- **深度模式（Deep）**：全面的代码质量分析
  - 包含中度模式的所有检查
  - 跨模块依赖分析
  - 性能热点识别
  - 架构设计评估
  - 可维护性分析
  - 适用场景：重要功能、架构变更

### 🔍 智能上下文收集

- **依赖图分析**：自动构建文件间的依赖关系
- **周边代码提取**：提供变更函数的完整定义
- **相关文件检索**：基于 RAG 技术检索相关代码
- **配置文件识别**：自动包含 package.json、tsconfig.json 等

### 🛡️ 多维度风险评估

- **安全审查**：SQL 注入、XSS、CSRF、密钥泄露等
- **逻辑审查**：边界条件、异常处理、竞态条件等
- **性能审查**：N+1 查询、内存泄漏、不必要的计算等
- **代码质量**：命名规范、代码重复、过度耦合等

### 🎨 优化的提示词系统

- **模式专用指令**：每个分析模式都有专门的提示词约束
- **疑罪从无原则**：上下文不足时降低风险评级
- **功能变更识别**：区分代码缺陷和产品决策
- **Chain-of-Thought**：结构化的推理过程

### 💾 数据持久化

- **分析历史**：保存所有审查记录
- **上下文快照**：记录每次分析的完整上下文
- **可重新分析**：支持使用不同模式重新审查

### 🔧 灵活的模型配置

- **多模型支持**：OpenAI、Anthropic、DeepSeek、自定义模型
- **本地模型**：支持配置本地部署的模型（Ollama、LM Studio）
- **GitHub Token**：安全的 Token 管理

## 🚀 快速启动

### 前置要求

- **Node.js** 18+ 
- **pnpm** 8+
- **数据库**：PostgreSQL 14+（已内置备选连接，可选配置）

### 一键启动（推荐）

```bash
# 1. 克隆项目
git clone https://github.com/yourusername/ai-code-review-tool.git
cd ai-code-review-tool

# 2. 安装依赖
pnpm install

# 3. 初始化数据库（使用内置备选连接）
pnpm db:migrate

# 4. 启动开发服务器
pnpm dev
```

访问 http://localhost:3000 即可开始使用！

### 自定义配置（可选）

如需使用自己的数据库，创建 `.env` 文件：

```bash
# 数据库连接（可选，未配置时使用内置备选连接）
DATABASE_URL="postgresql://user:password@localhost:5432/ai_code_review"



# AI 模型配置（ UI 中配置）

```

### 生产部署

```bash
# 构建生产版本
pnpm build

# 启动生产服务器
pnpm start
```

## 📖 使用指南

### 基本流程

1. **输入 PR URL**：在首页输入 GitHub PR 链接
2. **选择分析模式**：根据需求选择轻度/中度/深度
3. **配置模型**（可选）：在设置页面配置 AI 模型
4. **开始分析**：等待 AI 完成审查
5. **查看结果**：查看风险项、建议和评论

### 分析结果解读

#### 风险等级

- **Critical**：严重问题，可能导致系统崩溃或数据丢失
- **High**：高风险，存在明确的逻辑错误或安全漏洞
- **Medium**：中风险，潜在问题但不会立即导致错误
- **Low**：低风险，代码质量改进建议

#### 置信度

- **High**：问题在代码中直接可见，无需推断
- **Medium**：问题有一定证据，但需要额外确认
- **Low**：问题是推测性的，证据不足

## 🎨 技术栈

### 前端技术

| 技术 | 版本 | 用途 |
|------|------|------|
| **Next.js** | 16.2.6 | 全栈框架（App Router） |
| **React** | 19 | UI 库 |
| **TypeScript** | latest | 类型安全 |
| **Tailwind CSS** | 4.1.12 | 样式框架 |
| **Radix UI** | - | 无障碍组件库 |
| **shadcn/ui** | - | UI 组件集合 |
| **Motion** | 12.23.24 | 动画库（Framer Motion） |
| **Lucide Icons** | 0.487.0 | 图标库 |

### 后端技术

| 技术 | 版本 | 用途 |
|------|------|------|
| **Node.js** | 18+ | 运行时环境 |
| **Next.js API Routes** | 16.2.6 | RESTful API |
| **Prisma** | 7.8.0 | ORM 框架 |
| **PostgreSQL** | 14+ | 关系型数据库 |
| **pg** | 8.21.0 | PostgreSQL 驱动 |

### AI 集成

| 服务 | SDK | 支持模型 |
|------|-----|---------|
| **OpenAI** | openai@6.39.1 | GPT-4o, GPT-4o-mini |
| **Anthropic** | @anthropic-ai/sdk | Claude Opus 4.8, Sonnet 4.6, Haiku 4.5 |
| **DeepSeek** | openai@6.39.1 | DeepSeek Chat (V3) |
| **自定义模型** | openai@6.39.1 | 任何 OpenAI 兼容 API |

### 开发工具

- **包管理器**：pnpm 8+
- **代码规范**：ESLint
- **类型检查**：TypeScript
- **数据库管理**：Prisma Studio

## 🧠 系统设计思路

### 1. 模型选择策略

#### 多模型支持架构

系统采用**提供商抽象层**设计，支持多种 AI 模型：

```typescript
// 提供商接口
interface ModelProvider {
  analyze(request: ModelAnalysisRequest): Promise<ModelAnalysisResult>;
  analyzeStream(request: ModelAnalysisRequest): AsyncIterable<StreamChunk>;
}

// 支持的提供商
- OpenAI Provider (GPT-4o, GPT-4o-mini)
- Anthropic Provider (Claude Opus/Sonnet/Haiku)
- DeepSeek Provider (DeepSeek Chat V3)
- Custom Provider (任何 OpenAI 兼容 API)
```

#### 模型选择原则

1. **灵活配置**：用户可在 UI 中配置任意模型
2. **OpenAI 兼容**：支持所有兼容 OpenAI API 格式的模型
3. **本地模型**：支持 Ollama、LM Studio 等本地部署
4. **无供应商锁定**：轻松切换不同 AI 服务

#### 适用场景

| 模型类型 | 适用场景 | 优势 |
|---------|---------|------|
| **GPT-4o** | 复杂逻辑、架构审查 | 推理能力强、中文支持好 |
| **Claude Sonnet** | 安全审查、代码质量 | 安全意识强、细节把控好 |
| **DeepSeek** | 中文项目、成本敏感 | 性价比高、中文优秀 |
| **本地模型** | 隐私敏感、离线使用 | 数据安全、无网络依赖 |

### 2. 上下文获取方式

#### 三级上下文收集策略

系统根据分析深度采用不同的上下文收集策略：

```
轻度模式（Fast）
├── Diff 内容（仅变更部分）
└── 基础元数据（PR 标题、描述）

中度模式（Standard）
├── 轻度模式的所有内容
├── 周边代码（变更函数的完整定义）
├── 依赖关系图（import/export 分析）
└── 配置文件（package.json, tsconfig.json）

深度模式（Deep）
├── 中度模式的所有内容
├── 相关文件（基于 RAG 检索）
├── PR 评论和讨论
└── 完整文件内容（关键文件）
```

#### 智能上下文优先级

```typescript
// 上下文优先级排序
1. 直接变更的代码（最高优先级）
2. 被变更代码调用的函数
3. 调用变更代码的函数
4. 同文件的其他函数
5. 依赖的外部模块
6. 配置文件和类型定义
```

#### Token 预算管理

- **动态截断**：根据 Token 限制智能截断 Diff
- **优先级保留**：优先保留高优先级上下文
- **估算机制**：实时估算 Token 使用量

### 3. 提示词系统设计

#### 模块化提示词架构

```
提示词组成 = 基础系统提示词 + 模式专用指令 + CoT 指令 + Few-shot 示例 + 语言特定规则
```

**核心设计原则：**

1. **职责边界清晰**
   - 轻度：只分析 Diff 内可见问题
   - 中度：结合上下文分析逻辑
   - 深度：全面分析但区分代码问题和功能变更

2. **疑罪从无原则**
   - 上下文不足时降低风险评级
   - 代码删除默认假设是有意为之
   - 看不到调用方假设已正确处理

3. **功能变更识别**
   - 区分代码缺陷和产品决策
   - 功能变更不计入风险评级
   - 在 reviewComments 中单独标注

#### 提示词优化历程

**第一阶段：轻度模式优化**
- 严格限制分析范围，防止过度推断
- 添加"疑罪从无"原则
- 修正总体风险计算规则

**第二阶段：中度和深度模式完善**
- 明确各模式的上下文范围和分析边界
- 区分代码缺陷和功能变更
- 优化 Chain-of-Thought 指令

详细分析：[PROMPT_OPTIMIZATION_ANALYSIS.md](./PROMPT_OPTIMIZATION_ANALYSIS.md)

### 4. 未来扩展方向

#### 短期规划（1-3 个月）

- [ ] **增量分析**：仅分析新增的 commit，提升效率
- [ ] **自动修复**：基于风险建议自动生成修复代码
- [ ] **团队协作**：支持多人审查、评论和讨论
- [ ] **自定义规则**：允许团队配置特定的审查规则
- [ ] **Webhook 集成**：PR 创建时自动触发审查

#### 中期规划（3-6 个月）

- [ ] **性能分析**：集成性能测试和基准测试
- [ ] **安全扫描**：集成 SAST/DAST 工具
- [ ] **代码度量**：圈复杂度、代码覆盖率等指标
- [ ] **历史趋势**：代码质量趋势分析和可视化

#### 长期规划（6-12 个月）

- [ ] **AI 训练**：基于团队历史审查数据微调模型
- [ ] **智能推荐**：根据代码风格推荐最佳实践
- [ ] **架构分析**：识别架构问题和技术债
- [ ] **自动化测试生成**：基于代码变更生成测试用例
- [ ] **IDE 插件**：支持 VS Code、JetBrains 等 IDE

#### 技术演进方向

1. **模型能力提升**
   - 支持更大上下文窗口（200K+）
   - 集成多模态模型（代码 + 文档 + 图表）
   - 探索专用代码模型（CodeLlama、StarCoder）

2. **上下文增强**
   - 集成代码图谱（Code Graph）
   - 支持跨仓库依赖分析
   - 引入语义搜索和向量数据库

3. **用户体验优化**
   - 实时协作编辑
   - 移动端支持
   - 浏览器插件（Chrome/Edge）

4. **企业级特性**
   - SSO 单点登录
   - 权限管理和审计日志
   - 私有化部署方案
   - SLA 保障和监控

## 🏗️ 项目架构

```
src/
├── app/                          # Next.js App Router
│   ├── api/                      # API 路由
│   │   ├── analyze/              # 分析 API
│   │   │   ├── helpers/          # 辅助函数
│   │   │   │   ├── message-builder.ts    # 消息构建
│   │   │   │   ├── diff-utils.ts         # Diff 处理
│   │   │   │   ├── context-snapshot.ts   # 上下文快照
│   │   │   │   ├── data-normalizer.ts    # 数据标准化
│   │   │   │   └── json-parser.ts        # JSON 解析
│   │   │   └── route.ts          # 分析路由
│   │   └── analyses/[id]/        # 分析详情 API
│   ├── components/               # React 组件
│   │   └── ui/                   # UI 组件库
│   ├── analysis/[id]/            # 分析详情页
│   ├── history/                  # 历史记录页
│   └── settings/                 # 设置页
│       ├── github-token/         # GitHub Token 配置
│       └── local-models/         # 本地模型配置
├── lib/                          # 核心库
│   ├── prompts/                  # 提示词系统
│   │   ├── system-base.ts        # 基础系统提示词
│   │   ├── fast-mode-instructions.ts     # 轻度模式指令
│   │   ├── standard-mode-instructions.ts # 中度模式指令
│   │   ├── deep-mode-instructions.ts     # 深度模式指令
│   │   ├── cot-instructions.ts   # Chain-of-Thought 指令
│   │   ├── composer.ts           # 提示词组装器
│   │   ├── few-shot/             # Few-shot 示例
│   │   └── language-specific/    # 语言特定规则
│   ├── context/                  # 上下文收集
│   │   ├── collector.ts          # 上下文收集器
│   │   ├── prioritizer.ts        # 优先级排序
│   │   ├── token-counter.ts      # Token 计数
│   │   └── sources/              # 上下文源
│   │       ├── dependencies.ts   # 依赖图
│   │       ├── full-files.ts     # 完整文件
│   │       └── related-files.ts  # 相关文件
│   ├── models/                   # AI 模型
│   │   ├── registry.ts           # 模型注册表
│   │   ├── router.ts             # 模型路由
│   │   ├── provider-factory.ts   # 提供商工厂
│   │   └── providers/            # 模型提供商
│   │       ├── openai.ts
│   │       ├── anthropic.ts
│   │       ├── deepseek.ts
│   │       └── custom.ts
│   ├── validation/               # 数据验证
│   │   ├── schema.ts             # JSON Schema
│   │   ├── quality.ts            # 质量检查
│   │   └── consistency.ts        # 一致性检查
│   ├── cache/                    # 缓存系统
│   ├── github.ts                 # GitHub API
│   ├── prisma.ts                 # Prisma 客户端
│   └── analysis-store.ts         # 分析存储
├── types/                        # TypeScript 类型定义
└── generated/                    # 生成的代码（Prisma）
```

## 🔧 可用脚本

```bash
# 开发
pnpm dev              # 启动开发服务器
pnpm build            # 构建生产版本
pnpm start            # 启动生产服务器
pnpm lint             # 代码检查

# 数据库
pnpm db:generate      # 生成 Prisma 客户端
pnpm db:migrate       # 运行数据库迁移（开发）
pnpm db:migrate:prod  # 运行数据库迁移（生产）
pnpm db:push          # 推送 schema 到数据库
pnpm db:pull          # 从数据库拉取 schema
pnpm db:reset         # 重置数据库
pnpm db:studio        # 打开 Prisma Studio
pnpm db:seed          # 填充种子数据
```

## 📊 项目亮点

### 技术创新

1. **三级分析模式**：根据需求灵活选择分析深度，平衡速度和质量
2. **智能上下文收集**：基于依赖图和 RAG 技术精准获取相关代码
3. **模块化提示词系统**：职责边界清晰，疑罪从无，区分代码问题和功能变更
4. **多模型支持**：提供商抽象层设计，支持任意 OpenAI 兼容模型

### 工程实践

1. **类型安全**：全栈 TypeScript，端到端类型检查
2. **数据持久化**：Prisma ORM + PostgreSQL，完整的分析历史
3. **性能优化**：智能缓存、Token 预算管理、流式响应
4. **用户体验**：响应式设计、实时反馈、一键启动

### 可扩展性

1. **提供商抽象**：轻松集成新的 AI 模型
2. **模块化架构**：清晰的代码组织，易于维护和扩展
3. **配置灵活**：支持环境变量、UI 配置、备选连接
4. **开放设计**：详细的架构文档，便于二次开发

## 🤝 贡献指南

欢迎提交 Issue 和 Pull Request！

### 开发流程

1. Fork 本仓库
2. 创建特性分支：`git checkout -b feature/amazing-feature`
3. 提交更改：`git commit -m 'feat: add amazing feature'`
4. 推送到分支：`git push origin feature/amazing-feature`
5. 提交 Pull Request

### Commit 规范

使用 [Conventional Commits](https://www.conventionalcommits.org/) 规范：

- `feat`: 新功能
- `fix`: 修复 Bug
- `docs`: 文档更新
- `style`: 代码格式调整
- `refactor`: 重构
- `perf`: 性能优化
- `test`: 测试相关
- `chore`: 构建/工具链相关


## 🙏 致谢

- 原始设计：[Figma Design](https://www.figma.com/design/XXxoL6MioJORlXuthdDndS/AI-Code-Review-Tool)
- UI 组件：[shadcn/ui](https://ui.shadcn.com/)
- 图标库：[Lucide Icons](https://lucide.dev/)

## 📮 联系方式

如有问题或建议，欢迎通过以下方式联系：

- 提交 [Issue](https://github.com/yourusername/ai-code-review-tool/issues)
- 发送邮件至：your.email@example.com
- 项目演示：[观看视频](https://your-video-link.com)

---

**Built with ❤️ using Next.js and AI**

> 本项目为路演作品，展示了 AI 在代码审查领域的创新应用。通过智能的模型选择、上下文获取和提示词设计，实现了高质量的自动化代码审查。
