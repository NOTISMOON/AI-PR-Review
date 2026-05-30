/**
 * Few-shot examples — demonstrate the ideal input-to-output mapping
 * for different scenarios. These are included in the system prompt to
 * calibrate the model's output quality and format.
 */

/** Small PR example (2-3 risks, simple changes) */
export const SMALL_PR_EXAMPLE = `
## 示例 1：小型 PR 审查

### 输入
PR 描述: "Fix login form validation — add email format check and prevent empty password submission"
变更文件: src/components/LoginForm.tsx (modified, +15/-3)

### 输出
{
  "summary": "本次 PR 修复了登录表单的验证逻辑，新增了邮箱格式校验和空密码拦截。变更范围小、目标明确，代码改动合理。但新增的正则校验存在 ReDoS 风险，且缺少对特殊字符的处理。",
  "riskLevel": "medium",
  "risks": [
    {
      "id": "risk-1",
      "severity": "medium",
      "title": "邮箱正则存在 ReDoS 风险",
      "description": "使用的邮箱验证正则表达式 /^[a-zA-Z0-9]+@[a-zA-Z0-9]+\\.[a-zA-Z]{2,}$/ 虽然目前安全，但正则使用了嵌套量词模式，如果后续修改不当可能引入 ReDoS 漏洞。建议使用成熟的邮箱验证库或简化为更安全的正则。",
      "file": "src/components/LoginForm.tsx",
      "line": 25,
      "code": "const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\\\.[a-zA-Z]{2,}$/;",
      "suggestion": "建议使用 validator.js 或 zod 的 email 验证，避免手写正则带来的安全隐患。如果必须手写正则，移除不必要的可选分组和嵌套量词。",
      "confidence": "medium",
      "confidenceRationale": "当前正则没有明显漏洞，但嵌套量词模式是一种代码异味，后续维护中容易引入问题",
      "category": "security"
    },
    {
      "id": "risk-2",
      "severity": "low",
      "title": "密码空值检查可增强",
      "description": "当前仅在前端检查密码是否为空，建议在后端 API 中也增加空值校验作为纵深防御。",
      "file": "src/components/LoginForm.tsx",
      "line": 32,
      "code": "if (!password.trim()) { setError('密码不能为空'); return; }",
      "suggestion": "在对应的 API 路由中也添加密码非空验证，防止绕过前端验证直接调用 API。",
      "confidence": "high",
      "category": "quality"
    }
  ],
  "reviewComments": [
    {
      "id": "comment-1",
      "type": "positive",
      "comment": "新增的邮箱格式校验提升了用户体验，避免无效格式的请求到达后端。"
    },
    {
      "id": "comment-2",
      "type": "suggestion",
      "comment": "建议将表单验证逻辑抽取为独立的验证函数或使用 zod schema，便于复用和测试。"
    },
    {
      "id": "comment-3",
      "type": "positive",
      "comment": "错误提示信息清晰友好，避免了技术性错误信息暴露给用户。"
    }
  ]
}`;

/** Large PR example (5-7 risks, complex changes) */
export const LARGE_PR_EXAMPLE = `
## 示例 2：大型 PR 审查

### 输入
PR 描述: "Implement user authentication with JWT, add role-based access control, integrate OAuth2.0"
变更文件: 12 files (8 added, 4 modified, +456/-89)
涉及: auth/login.ts, auth/jwt.ts, auth/oauth.ts, models/User.ts, middleware/auth.ts

### 输出
{
  "summary": "本次 PR 引入了用户认证系统，包括 JWT 令牌管理、OAuth2.0 第三方登录和 RBAC 权限控制。整体架构设计合理，但存在几个需要关注的安全问题：密码未加密存储、JWT 密钥硬编码、以及 SQL 查询使用了字符串拼接。这些问题应在合并前修复。（注：由于 diff 较大，可能存在遗漏的风险项）",
  "riskLevel": "high",
  "risks": [
    {
      "id": "risk-1",
      "severity": "critical",
      "title": "密码以明文形式存储",
      "description": "用户注册时密码直接以明文存入数据库，这是严重的安全漏洞。一旦数据库泄露，所有用户密码将直接暴露。影响场景：攻击者通过SQL注入或数据库访问获取用户表后可直接登录任意账号。",
      "file": "src/auth/register.ts",
      "line": 28,
      "code": "await db.users.create({ email, password, name });",
      "suggestion": "使用 bcrypt 或 argon2 对密码进行哈希处理。示例: const hashedPassword = await bcrypt.hash(password, 12); await db.users.create({ email, password: hashedPassword, name });",
      "confidence": "high",
      "category": "security"
    },
    {
      "id": "risk-2",
      "severity": "critical",
      "title": "SQL 查询使用字符串拼接",
      "description": "登录查询直接拼接用户输入到 SQL 语句中，存在 SQL 注入漏洞。影响场景：攻击者可在邮箱字段输入 ' OR '1'='1 绕过认证。",
      "file": "src/auth/login.ts",
      "line": 45,
      "code": "const query = 'SELECT * FROM users WHERE email = ' + email + ' AND password = ' + password;",
      "suggestion": "使用参数化查询: db.query('SELECT * FROM users WHERE email = ?', [email])。或使用 ORM 的安全查询方法。",
      "confidence": "high",
      "category": "security"
    },
    {
      "id": "risk-3",
      "severity": "high",
      "title": "JWT 密钥硬编码在源码中",
      "description": "JWT 签名密钥以明文硬编码在代码中。影响场景：代码泄露（如公开仓库）将导致攻击者可伪造任意用户的 JWT 令牌。",
      "file": "src/auth/jwt.ts",
      "line": 12,
      "code": "const SECRET_KEY = 'my-super-secret-key-123';",
      "suggestion": "将密钥移至环境变量: const SECRET_KEY = process.env.JWT_SECRET; 并在部署时配置，确保不提交到版本控制。",
      "confidence": "high",
      "category": "security"
    },
    {
      "id": "risk-4",
      "severity": "medium",
      "title": "OAuth state 参数未验证",
      "description": "OAuth 回调未验证 state 参数，存在 CSRF 攻击风险。虽然多数 OAuth 提供商会返回 state，但缺少验证步骤。",
      "file": "src/auth/oauth.ts",
      "line": 67,
      "code": "const { code } = req.query; const token = await exchangeCode(code);",
      "suggestion": "在发起 OAuth 请求时生成随机 state 并存入 session，回调时验证 state 是否匹配。",
      "confidence": "medium",
      "confidenceRationale": "未看到完整的 OAuth 流程代码，可能 state 验证在其他文件中实现",
      "category": "security"
    },
    {
      "id": "risk-5",
      "severity": "medium",
      "title": "Token 未设置过期时间",
      "description": "JWT 令牌生成时未设置 exp 字段，令牌将永久有效。一旦泄露，攻击者可长期使用。",
      "file": "src/auth/jwt.ts",
      "line": 22,
      "code": "const token = jwt.sign(payload, SECRET_KEY);",
      "suggestion": "设置合理的过期时间: jwt.sign(payload, SECRET_KEY, { expiresIn: '24h' })。并实现 refresh token 机制。",
      "confidence": "high",
      "category": "security"
    }
  ],
  "reviewComments": [
    {
      "id": "comment-1",
      "type": "positive",
      "comment": "认证系统的模块化设计很好，login、jwt、oauth 各模块职责清晰，便于独立测试和维护。"
    },
    {
      "id": "comment-2",
      "type": "concern",
      "comment": "建议添加单元测试覆盖核心认证逻辑，特别是密码验证和 token 生成，当前 PR 中缺少测试文件。"
    },
    {
      "id": "comment-3",
      "type": "suggestion",
      "comment": "建议在登录端点添加速率限制，防止暴力破解攻击。可使用 express-rate-limit 或类似的中间件。"
    },
    {
      "id": "comment-4",
      "type": "suggestion",
      "comment": "建议添加认证失败的审计日志，记录失败的登录尝试，便于安全事件追踪。"
    },
    {
      "id": "comment-5",
      "type": "positive",
      "comment": "TypeScript 类型定义完整，User 接口和 JWT payload 的类型定义增强了代码的可维护性。"
    }
  ]
}`;
