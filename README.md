# System Design for Frontend Engineers

前端工程师转全栈的后端系统设计学习仓库。通过可运行的 Demo 项目，帮助前端同学理解后端常见的架构模式和设计思路。

## 目标读者

有一定前端开发经验，希望向全栈方向发展，需要系统学习后端设计思维的工程师。

## 项目列表

| 项目 | 主题 | 核心知识点 |
|------|------|-----------|
| [bullmq-demo](./bullmq-demo) | 消息队列与任务调度 | BullMQ、Redis、定时任务、重试机制、幂等设计 |
| [drizzle-migration-cicd-demo](./drizzle-migration-cicd-demo) | 数据库迁移与部署流程 | Drizzle Migration、预编译脚本、Docker、GitHub Actions、部署前迁移 |

## 学习路线

### 已有内容

1. **消息队列与异步任务** — 用 BullMQ 实现订阅到期提醒，学习队列、Worker、定时调度、失败重试等核心概念
2. **数据库迁移与部署** — 学习为什么 migration 更适合放在部署阶段执行，而不是绑在每次应用启动前

### 规划中

- 数据库设计与 ORM
- RESTful API 设计
- 认证与授权（JWT / Session）
- 缓存策略（Redis 缓存、CDN）
- 限流与熔断
- 日志与监控
- 微服务与服务间通信
- 容器化部署（Docker / K8s）

## 技术栈

- **语言**: TypeScript（对前端同学最友好的全栈语言）
- **运行时**: Node.js
- **包管理**: pnpm

## 快速开始

```bash
# 克隆仓库
git clone <repo-url>
cd system-design

# 进入感兴趣的项目，按各自 README 运行
cd bullmq-demo
pnpm install
pnpm run demo
```

## 每个 Demo 的结构

每个子项目都遵循统一结构：

- `README.md` — 方案说明、架构图、运行方式
- `TUTORIAL.md` — 分步教程（如有）
- `src/` — 完整可运行的代码
- `docker-compose.yml` — 所需的基础设施（Redis、DB 等）

## 贡献

欢迎补充新的系统设计 Demo，提交 PR 时请确保：

1. 包含清晰的 README 说明设计思路
2. 代码可直接运行
3. 面向前端背景的同学，用前端类比解释后端概念
