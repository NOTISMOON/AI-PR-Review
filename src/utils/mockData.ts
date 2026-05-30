import type { AnalysisData } from '../types/analysis';

export function generateMockAnalysis(prUrl: string): AnalysisData {
  const match = prUrl.match(/github\.com\/([^\/]+)\/([^\/]+)\/pull\/(\d+)/);
  const owner = match?.[1] || 'example-org';
  const repo = match?.[2] || 'example-repo';
  const prNumber = match?.[3] || '123';

  return {
    prInfo: {
      title: 'Add user authentication and authorization system',
      number: parseInt(prNumber),
      author: 'developer-' + Math.floor(Math.random() * 100),
      branch: 'feature/auth-system',
      filesChanged: 12,
      additions: 456,
      deletions: 89,
      body: 'This PR introduces a complete user authentication and authorization system with JWT support, OAuth2.0 integration, and RBAC.',
      headSha: 'abc123def456',
      baseBranch: 'main',
    },
    summary: `本次 PR 引入了完整的用户认证和授权系统。主要变更包括：实现了基于 JWT 的身份验证机制，添加了用户登录、注册和密码重置功能，集成了 OAuth 2.0 第三方登录支持（Google、GitHub），以及基于角色的访问控制（RBAC）系统。代码质量整体良好，但在安全性和错误处理方面需要注意一些潜在问题。`,
    riskLevel: 'medium' as const,
    risks: [
      {
        id: 'risk-1',
        severity: 'high' as const,
        title: 'SQL 注入风险',
        description: '在用户登录功能中，直接拼接 SQL 查询字符串，存在 SQL 注入安全漏洞。',
        file: 'src/auth/login.ts',
        line: 45,
        code: `const query = \`SELECT * FROM users WHERE email = '\${email}' AND password = '\${password}'\`;
const user = await db.query(query);`,
        suggestion: '使用参数化查询或 ORM 来防止 SQL 注入。例如: db.query("SELECT * FROM users WHERE email = ? AND password = ?", [email, hashedPassword])',
        confidence: 'high' as const,
        category: 'security' as const,
      },
      {
        id: 'risk-2',
        severity: 'critical' as const,
        title: '密码未加密存储',
        description: '用户密码以明文形式存储在数据库中，这是严重的安全隐患。',
        file: 'src/auth/register.ts',
        line: 28,
        code: `await db.users.create({
  email: email,
  password: password,
  name: name,
});`,
        suggestion: '使用 bcrypt 或 argon2 等加密算法对密码进行哈希处理后再存储。例如: password: await bcrypt.hash(password, 10)',
        confidence: 'high' as const,
        category: 'security' as const,
      },
      {
        id: 'risk-3',
        severity: 'medium' as const,
        title: 'JWT 密钥硬编码',
        description: 'JWT 签名密钥直接硬编码在代码中，应该通过环境变量管理。',
        file: 'src/auth/jwt.ts',
        line: 12,
        code: `const SECRET_KEY = 'my-super-secret-key-123';
const token = jwt.sign(payload, SECRET_KEY);`,
        suggestion: '将密钥移至环境变量: const SECRET_KEY = process.env.JWT_SECRET; 并在 .env 文件中配置，确保 .env 文件不被提交到版本控制。',
        confidence: 'high' as const,
        category: 'security' as const,
      },
      {
        id: 'risk-4',
        severity: 'low' as const,
        title: '缺少错误处理',
        description: '数据库操作缺少适当的错误处理，可能导致应用崩溃或信息泄露。',
        file: 'src/auth/oauth.ts',
        line: 67,
        code: `const userData = await fetchUserFromProvider(token);
const user = await createOrUpdateUser(userData);
return user;`,
        suggestion: '添加 try-catch 块并返回适当的错误响应，避免向客户端暴露敏感错误信息。',
        confidence: 'medium' as const,
        category: 'quality' as const,
      },
    ],
    reviewComments: [
      {
        id: 'comment-1',
        type: 'positive' as const,
        comment: '代码结构清晰，模块化设计良好。认证逻辑与业务逻辑分离得很好。',
      },
      {
        id: 'comment-2',
        type: 'positive' as const,
        comment: 'TypeScript 类型定义完整，增强了代码的可维护性和类型安全。',
      },
      {
        id: 'comment-3',
        type: 'concern' as const,
        comment: '建议添加单元测试覆盖认证相关的核心功能，特别是密码验证和 token 生成逻辑。',
      },
      {
        id: 'comment-4',
        type: 'suggestion' as const,
        comment: '考虑添加速率限制（rate limiting）来防止暴力破解攻击，特别是在登录端点。',
      },
      {
        id: 'comment-5',
        type: 'suggestion' as const,
        comment: 'JWT token 应设置合理的过期时间，并实现 refresh token 机制以提升用户体验和安全性。',
      },
      {
        id: 'comment-6',
        type: 'concern' as const,
        comment: '需要添加日志记录来追踪登录尝试和认证失败事件，便于安全审计。',
      },
    ],
    fileChanges: [
      { file: 'src/auth/login.ts', additions: 78, deletions: 5, status: 'modified' as const },
      { file: 'src/auth/register.ts', additions: 92, deletions: 0, status: 'added' as const },
      { file: 'src/auth/jwt.ts', additions: 45, deletions: 0, status: 'added' as const },
      { file: 'src/auth/oauth.ts', additions: 134, deletions: 0, status: 'added' as const },
      { file: 'src/auth/middleware.ts', additions: 56, deletions: 12, status: 'modified' as const },
      { file: 'src/models/User.ts', additions: 34, deletions: 8, status: 'modified' as const },
      { file: 'src/routes/auth.routes.ts', additions: 67, deletions: 15, status: 'modified' as const },
      { file: 'src/config/passport.ts', additions: 89, deletions: 0, status: 'added' as const },
      { file: 'tests/auth/login.test.ts', additions: 45, deletions: 0, status: 'added' as const },
      { file: 'package.json', additions: 8, deletions: 2, status: 'modified' as const },
      { file: 'README.md', additions: 23, deletions: 5, status: 'modified' as const },
      { file: '.env.example', additions: 6, deletions: 0, status: 'added' as const },
    ],
  };
}
