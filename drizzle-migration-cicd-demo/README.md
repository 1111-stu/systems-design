# Drizzle Migration + CI/CD Demo

用一个最小的 Node.js 服务演示这条部署链路：

```
构建镜像
  ↓
预编译 migration 脚本
  ↓
CI/CD 部署时单独执行 migration
  ↓
migration 成功后再启动应用
```

## 为什么这个方案更推荐

很多项目会在容器启动时这样做：

```sh
node dist/migrate.js && node dist/server.js
```

它在单机阶段能工作，但到了生产环境会遇到几个典型问题：

- 多实例同时启动时，所有实例都会尝试跑 migration
- migration 失败会直接导致应用起不来
- 应用容器需要额外的数据库变更权限
- 数据库变更和应用启动耦合太紧，不利于回滚

这个 demo 展示的更推荐流程是：

- 应用镜像里包含 `dist/migrate.js`
- CI/CD 在部署前显式执行 `node dist/migrate.js`
- 只有 migration 成功后，才启动新版本应用

## 一个镜像，两种容器

这里最容易混淆的是 `image` 和 `container`。

- `image` 是静态模板
- `container` 是根据镜像启动出来的运行实例

这个 demo 里，不是“一个容器同时做两件事”，而是：

1. 用同一个镜像启动一个临时的 migration 容器
2. migration 成功后，再用同一个镜像启动一个长期运行的 app 容器

也就是说，同一个镜像会被用两次，但会产生两个不同的容器。

### 1. 临时 migration 容器

```bash
docker run --rm --env-file .env <image> node dist/migrate.js
```

这条命令的意思是：

- 用 `<image>` 启动一个临时容器
- 这次不跑默认启动命令，而是改成执行 `node dist/migrate.js`
- 执行完 migration 后容器退出
- 因为带了 `--rm`，退出后容器会自动删除

所以 migration 容器只是部署时临时用一下，不会长期保留。

### 2. 长期运行的 app 容器

```bash
docker run -d --name drizzle-demo --env-file .env -p 3000:3000 <image>
```

这条命令会启动真正在线上提供服务的应用容器。

因为 [Dockerfile](./Dockerfile) 里默认写的是：

```dockerfile
CMD ["node", "dist/src/server.js"]
```

所以这个容器启动后会一直运行应用服务。

### 为什么不需要单独的 Dockerfile

不需要再为 migration 单独写一个镜像或 Dockerfile。

只要当前镜像里已经包含：

- `dist/src/server.js`
- `dist/migrate.js`

就可以：

- 默认拿它来启动应用
- 需要时临时覆盖命令，拿它来跑 migration

也就是说，区别不在 Dockerfile，而在 `docker run` 时传入的命令不同。

## 项目结构

```
drizzle-migration-cicd-demo/
├── README.md
├── Dockerfile
├── docker-compose.yml
├── package.json
├── src/
│   └── server.ts
├── db/
│   ├── index.ts
│   ├── load-env.ts
│   ├── migrate.ts
│   └── schema/
│       ├── index.ts
│       └── users.ts
├── drizzle/
│   ├── 0000_init.sql
│   └── meta/_journal.json
└── examples/
    └── deploy.yml
```

## 本地运行

1. 启动 PostgreSQL

```bash
docker compose up -d
```

2. 安装依赖

```bash
npm install
```

3. 配置环境变量

```bash
cp .env.example .env
```

4. 执行 migration

```bash
npm run db:migrate:run
```

5. 启动应用

```bash
npm run build
npm run start
```

访问 `http://127.0.0.1:3000`，会返回当前 `users` 表的记录数。

## 预编译 migration

这个 demo 的关键点是这条命令：

```bash
npm run db:build
```

它会把 `db/migrate.ts` 及其依赖打包成一个独立产物：

```bash
dist/migrate.js
```

这样部署时就不需要 `tsx`，只要运行：

```bash
node dist/migrate.js
```

## Docker 里的推荐用法

镜像构建时：

- `npm run build`
- `npm run db:build`

应用容器启动时只做一件事：

```bash
node dist/src/server.js
```

部署前单独跑迁移：

```bash
docker run --rm --env-file .env <image> node dist/migrate.js
```

这里的关键点是：

- 这会启动一个临时容器
- 只负责执行 migration
- 跑完后自动删除

真正长期运行的应用容器，还是后面单独启动的那个。

## GitHub Actions 示例

示例文件在 [examples/deploy.yml](./examples/deploy.yml)。

它表达的是最小流程：

1. 构建并推送镜像
2. SSH 到服务器
3. 先执行 `docker run --rm <image> node dist/migrate.js`
4. 成功后再替换线上容器

如果你要真正启用这个 workflow，请把它移动到仓库根目录的 `.github/workflows/deploy.yml`。
