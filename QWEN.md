# AI 诸棋混战 - 项目上下文文档

## 项目概述

**AI 诸棋混战** 是一个基于 Next.js 的多模式棋类游戏平台，支持三种棋类游戏和多种对战模式。

### 支持棋类

| 棋类 | 棋盘尺寸 |
|------|----------|
| 五子棋 (Gomoku) | 15x15 |
| 中国象棋 (Xiangqi) | 9x10 |
| 国际象棋 (Chess) | 8x8 |

### 对战模式

| 模式 | 说明 |
|------|------|
| **双 AI 对战** | 黑白/红黑双方均由 LLM 控制，自动轮流落子 |
| **单人对 AI** | 玩家选择一方与 AI 对战，支持选择先后手 |
| **双人对战** | 两人本地轮流对战（PvP），不使用 AI |

### 核心特性

- **前端驱动游戏逻辑**：走子合法性验证、胜负判断、候选移动与保底策略均在前端实现
- **后端仅做 LLM 调用**：通过 Vercel AI SDK 调用大语言模型
- **持久化 AI 会话**：每方 AI 拥有持续的上下文会话，不是每步重新开启
- **配置本地存储**：AI 配置保存在 `localStorage`
- **悔棋功能**：支持回退棋局（单人模式回退两步，其他模式回退一步）
- **先后手选择**：单人模式下可选择执黑/白或执红/黑

### 核心技术栈

| 类别 | 技术 |
|------|------|
| 框架 | Next.js 14 |
| 前端 | React 18 + TypeScript |
| AI SDK | Vercel AI SDK (`ai` v4) + `@ai-sdk/openai` |
| 包管理 | pnpm |
| Node 版本 | >= 18 |

### 架构特点

- **游戏模式**：每种棋类支持三种模式（双 AI、单人 AI、双人对战）
- **前端驱动游戏逻辑**：走子合法性验证、胜负判断、候选移动与保底策略均在前端实现
- **后端仅做 LLM 调用**：通过 Vercel AI SDK 调用大语言模型
- **持久化 AI 会话**：每方 AI 拥有持续的上下文会话，不是每步重新开启
- **配置本地存储**：黑/白（或红/黑）AI 的 API 配置保存在 `localStorage`
- **API 配置按阵营分离**：黑方和白方可以配置不同的 API URL、Model 和 API Key

---

## 构建与运行

### 安装依赖

```bash
pnpm install
```

### 开发模式

```bash
pnpm dev
```

访问：`http://localhost:3000`

### 生产构建

```bash
pnpm build
pnpm start
```

### 代码检查

```bash
pnpm lint
```

### 环境变量（可选）

创建 `.env.local` 文件（参考 `.env.example`）：

```bash
# LLM 请求超时（毫秒）
LLM_TIMEOUT_MS=25000
```

---

## 项目结构

```
ai-zhuqi-battle/
├── app/                          # Next.js 应用主目录
│   ├── api/
│   │   └── llm/move/route.ts     # LLM 调用 API 端点（Vercel AI SDK）
│   ├── GameHubClient.tsx         # 游戏模式切换入口（五子棋/象棋/国际象棋）
│   ├── GomokuClient.tsx          # 五子棋前端逻辑
│   ├── XiangqiClient.tsx         # 中国象棋前端逻辑
│   ├── ChessClient.tsx           # 国际象棋前端逻辑
│   ├── page.tsx                  # 首页入口
│   ├── layout.tsx                # 根布局
│   └── globals.css               # 全局样式
├── lib/                          # 共享工具库
│   ├── chess/                    # 国际象棋模块
│   │   ├── conversation.ts       # AI 会话管理
│   │   ├── fallback.ts           # 保底策略
│   │   ├── game.ts               # 游戏规则与状态
│   │   ├── move-parser.ts        # LLM 走子解析
│   │   ├── prompt.ts             # AI 提示词
│   │   └── types.ts              # 类型定义
│   ├── xiangqi/                  # 中国象棋模块（结构同上）
│   ├── gomoku/                   # 五子棋模块（结构同上）
│   ├── hooks/                    # React Hooks
│   ├── boardCanvas.ts            # 棋盘绘制工具
│   ├── game.ts                   # 通用游戏逻辑
│   └── shared-llm-config.ts      # 共享 LLM 配置管理（localStorage）
├── .env.example                  # 环境变量示例
├── next.config.mjs               # Next.js 配置
├── package.json                  # 项目依赖与脚本
├── tsconfig.json                 # TypeScript 配置
└── README.md                     # 项目说明文档
```

---

## 开发规范

### 代码风格

- **TypeScript 严格模式**：`tsconfig.json` 中启用了 `strict: true`
- **ES 模块**：使用 ESNext 模块系统，`moduleResolution: "bundler"`
- **React 严格模式**：`next.config.mjs` 中启用 `reactStrictMode: true`
- **无 JS 混用**：`allowJs: false`，仅使用 TypeScript

### 模块组织

每种棋类游戏遵循统一的模块结构：

```
lib/{game}/
├── types.ts          # 类型定义（配置、消息、移动等）
├── prompt.ts         # AI 提示词构建
├── conversation.ts   # 会话历史管理
├── move-parser.ts    # LLM 响应解析
├── fallback.ts       # 保底策略（当 AI 无法决策时）
└── game.ts           # 游戏规则与状态机
```

### LLM 集成模式

所有棋类游戏共用统一的 LLM 调用流程：

1. 前端构建提示词（`prompt.ts`）
2. 调用 `/api/llm/move` 端点
3. 服务端使用 Vercel AI SDK 调用 LLM
4. 解析返回的走子信息（`move-parser.ts`）
5. 更新棋盘状态

### 配置管理

- **默认 API**：`https://api.openai.com/v1`
- **默认模型**：`gpt-4.1-mini`
- **默认温度**：`0.2`
- **配置存储**：使用 `localStorage`，支持按阵营（黑/白）分别存储

---

## 关键文件说明

| 文件 | 作用 |
|------|------|
| `app/GameHubClient.tsx` | 游戏模式选择与切换 |
| `app/api/llm/move/route.ts` | LLM 调用服务端入口，支持 Responses API 和 Chat Completions API 回退 |
| `lib/shared-llm-config.ts` | 管理 localStorage 中的 LLM 配置，支持 legacy 兼容 |
| `lib/gomoku/types.ts` | 定义通用类型接口（`SideConfigInput`、`ChatMessage`、`MoveHistoryItem` 等） |
| `lib/{game}/prompt.ts` | 构建 AI 走子提示词，包含棋盘状态和历史记录 |
| `lib/{game}/move-parser.ts` | 解析 LLM 返回的走子坐标和 reasoning |

---

## 注意事项

1. **API 配置**：双 AI 和单人 AI 模式需要配置 API URL、Model、API Key；双人对战模式（PvP）不需要 AI 配置
2. **开始对战**：配置完成后需点击"开始对战"按钮，AI 才会自动落子（双人对战模式直接点击棋盘落子）
3. **落子间隔**：仅在双 AI 和单人 AI 模式下可调整每步时间间隔（毫秒）
4. **悔棋规则**：
   - 双 AI/双人对战模式：每次回退一步
   - 单人 AI 模式：每次回退两步（玩家和 AI 各一步）
5. **先后手选择**：仅在单人 AI 模式下可用，游戏开始前选择
6. **LLM 超时处理**：通过 `LLM_TIMEOUT_MS` 环境变量控制请求超时
