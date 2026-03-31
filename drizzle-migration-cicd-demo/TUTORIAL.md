# Drizzle Migration + CI/CD Demo 教程

## 这个 demo 想说明什么

重点不是 Drizzle API 本身，而是部署职责拆分：

- `build` 负责生成产物
- `migrate` 负责变更数据库
- `start` 负责启动应用

把这三件事拆开后，部署流程会更稳定。

## 1. 为什么不建议“启动前自动迁移”

很多团队早期会写成：

```sh
node dist/migrate.js && node dist/server.js
```

这个写法的问题是：

- 每次应用启动都在顺手改库
- 多副本部署时会重复竞争 migration
- 失败时应用会直接 crash

它适合单机 demo，不太适合正式部署。

## 2. 这个 demo 的最小职责分层

### `src/server.ts`

最小业务服务，只负责启动 HTTP 服务并查询 `users` 表。

### `db/migrate.ts`

专门执行 migration，不负责启动应用。

### `Dockerfile`

构建两个产物：

- `dist/src/server.js`
- `dist/migrate.js`

然后让运行时容器只执行：

```sh
node dist/src/server.js
```

## 3. 为什么要预编译 migration

如果线上运行 migration 依赖 `tsx db/migrate.ts`，会有几个小问题：

- 运行时还要带 TypeScript 执行器
- 部署环境依赖更多
- 启动命令更不纯粹

预编译后：

```sh
node dist/migrate.js
```

会更像一个真正的部署命令。

## 4. 一个镜像，两个容器

这里很容易产生一个误解：

> “是不是在同一个容器里先跑 migration，再跑 app？”

更准确的说法不是这样。

应该理解为：

- 同一个 `image` 可以被重复使用
- 但每次 `docker run` 启动出来的，都是一个新的 `container`

所以这套流程其实是：

1. 用同一个镜像启动一个临时 migration 容器
2. migration 跑完后，这个容器退出并删除
3. 再用同一个镜像启动一个长期运行的 app 容器

### 临时 migration 容器

```sh
docker run --rm --env-file /path/to/.env <image> node dist/migrate.js
```

这里的意思是：

- 用 `<image>` 创建一个新容器
- 覆盖默认启动命令，改为执行 `node dist/migrate.js`
- migration 执行完成后容器退出
- 因为加了 `--rm`，退出后自动删除

所以它只是部署流程里的一个短命容器。

### 长期运行的 app 容器

```sh
docker run -d --env-file /path/to/.env -p 3000:3000 <image>
```

这个容器才是线上真正对外提供服务的容器。

它会执行 Dockerfile 里的默认命令：

```sh
node dist/src/server.js
```

### 为什么不需要两份 Dockerfile

不需要专门再做一个 migration 镜像。

只要这个镜像里同时包含：

- `dist/migrate.js`
- `dist/src/server.js`

就足够了。

区别只在于你启动容器时传入的命令不同。

## 5. GitHub Actions 里应该怎么接

推荐顺序：

1. 构建镜像
2. 推送镜像
3. 远程拉取镜像
4. 运行一次 migration
5. migration 成功后再启动新版本应用

对应的关键命令就是：

```sh
docker run --rm --env-file /path/to/.env <image> node dist/migrate.js
docker run -d --env-file /path/to/.env -p 3000:3000 <image>
```

这里第一条命令产生的是“临时 migration 容器”，第二条命令产生的是“长期 app 容器”。

## 6. 真实项目里怎么升级

从这个 demo 走到生产环境，通常会继续演进成：

- 用单独的 deploy job 跑 migration
- 给 migration 容器单独配置数据库高权限
- 应用容器只保留业务读写权限
- 在 Kubernetes 里改成 Job / Helm hook / pre-deploy step

## 7. 一句话总结

最推荐记住的不是某个命令，而是这条原则：

> migration 属于部署步骤，不属于应用启动步骤。
