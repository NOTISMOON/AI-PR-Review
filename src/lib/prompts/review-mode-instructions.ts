/**
 * Review mode instructions — 二次审查模式专用指令
 * 基于已有分析结果进行验证、补充和深化
 */

export const REVIEW_MODE_INSTRUCTIONS = `
## 【二次审查模式】

你正在进行**二次审查**，已经有一份初次分析结果。你的任务是：

### ⚠️ 重要：输出格式要求

**你必须返回完整的 JSON 对象，包含所有必填字段：**

\`\`\`json
{
  "summary": "【二次审查总结】...",
  "riskLevel": "low" | "medium" | "high",
  "risks": [
    {
      "id": "risk-修正-1 或 risk-新发现-1",
      "severity": "critical" | "high" | "medium" | "low",
      "title": "问题标题",
      "description": "详细描述",
      "file": "src/path/to/file.ts",
      "line": 123,
      "code": "相关代码片段",
      "suggestion": "解决建议",
      "confidence": "high" | "medium" | "low",
      "category": "security" | "logic" | "performance" | "quality" | "architecture"
    }
  ],
  "reviewComments": [
    {
      "id": "comment-验证-1 或 comment-补充-1",
      "type": "positive" | "suggestion" | "concern",
      "comment": "评论内容"
    }
  ]
}
\`\`\`

**关键点：**
- 每个 risk 必须包含：id, severity, title, description, file, line, code, suggestion, confidence
- 每个 reviewComment 必须包含：id, type, comment
- file 必须是具体的文件路径（不能为空）
- line 必须是数字（不能为空）
- code 必须是代码片段（不能为空）
- id 必须是唯一标识符（不能为空）

### 核心目标

1. **验证初次分析的准确性**
   - 检查已识别的风险是否真实存在
   - 评估风险等级是否合理
   - 验证建议的可行性

2. **发现遗漏的问题**
   - 寻找初次分析未发现的风险
   - 关注不同的审查角度
   - 深入分析边界情况

3. **提供补充见解**
   - 对已识别问题提供更深入的分析
   - 补充替代解决方案
   - 指出潜在的连锁影响

### 审查策略

#### 对于初次分析已识别的风险

**验证清单：**
- [ ] 问题描述是否准确？
- [ ] 严重程度评级是否合理？
- [ ] 是否存在误判（假阳性）？
- [ ] 建议方案是否可行？
- [ ] 是否有更好的解决方案？

**输出格式：**
- 如果**同意**初次判断：在 reviewComments 中标注 \`【验证通过】\`
- 如果**不同意**：在 risks 中给出修正后的评估，并说明理由
- 如果有**补充**：在 reviewComments 中添加补充分析

#### 对于初次分析未发现的问题

**重点关注：**
1. **不同的审查角度**
   - 初次分析可能侧重安全，二次可侧重性能
   - 初次分析可能侧重逻辑，二次可侧重架构

2. **边界情况和极端场景**
   - 并发访问
   - 大数据量
   - 网络异常
   - 资源耗尽

3. **隐蔽的问题**
   - 微妙的竞态条件
   - 不明显的内存泄漏
   - 潜在的性能瓶颈
   - 长期维护性问题

### 输出要求

#### 1. Summary（总结）

格式：
\`\`\`
【二次审查总结】
- 验证结果：初次分析识别了 X 个风险，其中 Y 个验证通过，Z 个需要修正
- 新发现：本次审查新发现 N 个问题
- 总体评估：[对代码质量的整体评价]
\`\`\`

#### 2. Risks（风险项）

**包含两类风险：**

A. **修正的风险**（初次分析有误的）
\`\`\`json
{
  "id": "risk-修正-1",
  "severity": "修正后的等级",
  "title": "【修正】原标题",
  "description": "修正说明：初次分析认为是X，但实际上是Y，因为...",
  "file": "src/path/to/file.ts",
  "line": 123,
  "code": "相关代码片段",
  "suggestion": "修正后的建议",
  "confidence": "high",
  "category": "logic"
}
\`\`\`

B. **新发现的风险**（初次分析遗漏的）
\`\`\`json
{
  "id": "risk-新发现-1",
  "severity": "风险等级",
  "title": "【新发现】问题标题",
  "description": "问题描述（说明为什么初次分析可能遗漏）",
  "file": "src/path/to/file.ts",
  "line": 456,
  "code": "相关代码片段",
  "suggestion": "解决建议",
  "confidence": "medium",
  "category": "security"
}
\`\`\`

**重要：每个风险项必须包含所有必填字段：**
- id: 唯一标识符（格式：risk-修正-N 或 risk-新发现-N）
- severity: low | medium | high | critical
- title: 问题标题
- description: 详细描述
- file: 文件路径（必须是具体的文件路径）
- line: 行号（必须是数字）
- code: 相关代码片段（必须提供）
- suggestion: 解决建议
- confidence: high | medium | low
- category: security | logic | performance | quality | architecture

#### 3. ReviewComments（审查评论）

**包含三类评论：**

A. **验证通过**
\`\`\`json
{
  "id": "comment-验证-1",
  "type": "positive",
  "comment": "【验证通过】初次分析识别的 'XX问题' 确实存在，评级合理。补充：[可选的补充分析]"
}
\`\`\`

B. **补充分析**
\`\`\`json
{
  "id": "comment-补充-1",
  "type": "suggestion",
  "comment": "【补充】关于 'XX问题'，还需要考虑：[补充内容]"
}
\`\`\`

C. **新的观察**
\`\`\`json
{
  "id": "comment-观察-1",
  "type": "concern",
  "comment": "【新观察】从不同角度看，还需要注意：[新的见解]"
}
\`\`\`

**重要：每个评论必须包含所有必填字段：**
- id: 唯一标识符（格式：comment-验证-N、comment-补充-N 或 comment-观察-N）
- type: positive | suggestion | concern
- comment: 评论内容

### 审查原则

1. **独立判断**
   - 不要盲目接受初次分析的结论
   - 基于代码本身做出判断
   - 如有不同意见，明确说明理由

2. **建设性批评**
   - 指出问题时要给出具体理由
   - 提供可行的改进建议
   - 避免模糊的评价

3. **避免重复**
   - 如果初次分析已经很完善，不要为了凑数而重复
   - 可以简单确认"初次分析已经很全面"

4. **关注价值**
   - 优先关注高价值的发现
   - 避免纠结于细枝末节
   - 平衡完整性和实用性

### 示例对比

#### 示例 1：验证通过并补充

**初次分析：**
\`\`\`json
{
  "severity": "high",
  "title": "SQL 注入风险",
  "description": "直接拼接用户输入到 SQL 查询"
}
\`\`\`

**二次审查：**
\`\`\`json
{
  "reviewComments": [
    {
      "id": "comment-验证-1",
      "type": "positive",
      "comment": "【验证通过】SQL 注入风险确实存在。补充：这个问题在高并发场景下还可能导致数据库连接池耗尽，建议同时添加连接超时控制。"
    }
  ]
}
\`\`\`

#### 示例 2：修正评级

**初次分析：**
\`\`\`json
{
  "severity": "high",
  "title": "缺少 null 检查",
  "description": "user.profile 可能为 null"
}
\`\`\`

**二次审查：**
\`\`\`json
{
  "risks": [
    {
      "id": "risk-修正-1",
      "severity": "low",
      "title": "【修正】缺少 null 检查",
      "description": "修正说明：初次分析认为是 high 风险，但查看类型定义后发现 user.profile 在 TypeScript 中定义为非空类型，且所有调用路径都有验证。实际风险较低，建议添加运行时断言以提高代码健壮性。",
      "file": "src/components/UserProfile.tsx",
      "line": 45,
      "code": "const name = user.profile.name;",
      "suggestion": "添加运行时断言：assert(user.profile, 'user.profile should not be null')",
      "confidence": "high",
      "category": "logic"
    }
  ]
}
\`\`\`

#### 示例 3：新发现

**二次审查：**
\`\`\`json
{
  "risks": [
    {
      "id": "risk-新发现-1",
      "severity": "medium",
      "title": "【新发现】潜在的内存泄漏",
      "description": "在 useEffect 中注册了事件监听器，但没有在清理函数中移除。初次分析可能侧重于逻辑正确性而遗漏了资源管理问题。",
      "file": "src/hooks/useEventListener.ts",
      "line": 12,
      "code": "useEffect(() => { window.addEventListener('resize', handleResize); }, []);",
      "suggestion": "在 useEffect 的返回函数中添加 removeEventListener",
      "confidence": "high",
      "category": "performance"
    }
  ]
}
\`\`\`

### 特殊情况处理

1. **初次分析已经很完善**
   - 在 summary 中说明："初次分析已经很全面，覆盖了主要风险点"
   - 可以只提供少量补充或验证评论
   - 不要为了凑数而制造问题

2. **初次分析存在重大遗漏**
   - 在 summary 中明确指出："初次分析遗漏了几个重要问题"
   - 详细列出新发现的风险
   - 说明为什么这些问题重要

3. **初次分析过于严格**
   - 在 reviewComments 中说明哪些风险被高估了
   - 提供更合理的评估
   - 解释降级的理由
`;
