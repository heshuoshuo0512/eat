# 独立菜品图片采集站

## 本地运行

```bash
npm install
npm run dev:collector-api
npm run dev:collector
```

- 采集站：`http://127.0.0.1:5174`
- 采集 API：`http://127.0.0.1:8790`
- SQLite：`collector-data/collector.sqlite`
- 私有图片：`collector-data/uploads/`

创建独立审核账号：

```bash
npm run collector:staff -- collector-admin "change-this-password" collector_admin
npm run collector:staff -- reviewer-01 "change-this-password" collector_reviewer
```

管理员在 `/admin` 把十个餐饮区分配给四组，并复核每组 50 道目标菜。目录有销量、评价数或评分时会优先排序；没有可靠热度数据时只做单菜过滤，最终“高频菜”清单必须由管理员确认。

## 数据规则

- 主标签为目录 `dish_id`，辅助标签为 `canonical_name`，食堂、餐饮区和档口是元数据。
- 每个目标菜至少 60 张审核通过图片、至少 10 位匿名贡献者。
- 导出固定取 40 张训练、10 张验证、10 张测试；贡献者及感知重复关联不会跨集合。
- 非目标菜的审核通过图片可进入 `unknown` 未覆盖集，但训练贡献者不会进入该集合。
- 草稿保留 24 小时，待映射和驳回图片保留 30 天，通过图片保留 12 个月。
- 撤回会删除原图、冲正积分，并把记录排除在后续导出之外。

## 数据集与训练

导出会在门槛不足或贡献者隔离后无法达到 40/10/10 时直接失败：

```bash
npm run collector:export -- --version collector-v1
```

安装训练依赖并执行完整流水线：

```bash
python -m pip install -r training/requirements.txt
npm run collector:train -- --version collector-v1 --model-version siglip-campus-v1
```

训练默认使用 `google/siglip-base-patch16-224`、随机种子 42、有效 batch 64、最多 20 epoch、早停 3 epoch。文本编码器和视觉前部冻结，只训练视觉最后两个 block、视觉投影、温度参数和训练期分类头。部署 checkpoint 不包含分类头依赖，输出维度必须为 768。

本地固定小数据集：

```bash
npm run collector:smoke-dataset
npm run collector:train -- --dataset collector-datasets/smoke-fixture --version smoke-fixture --model-version smoke-siglip --smoke
```

烟雾训练仍需下载基础模型。没有 OOD 指标、未运行基线 A/B，或任一指标不达标时，模型只登记为 `rejected`，不会写入可部署原型。

## 发布与回滚

先把通过门槛的类别原型发布到主应用数据库：

```bash
npm run collector:deploy -- --model-version siglip-campus-v1 --tenant default
```

同一租户只有一个 `deployed` 原型版本。重新发布旧版本即可回滚。推理服务使用同一 checkpoint：

```bash
VISION_EMBEDDING_CHECKPOINT=/models/siglip-campus-v1/checkpoint
VISION_EMBEDDING_MODEL_VERSION=siglip-campus-v1
```

`GET /health` 返回 `modelVersion`、设备、加载状态、错误和 768 维契约。主应用 `VISION_EMBEDDING_MODEL_VERSION` 应与之保持一致。

## 独立服务器

```bash
Copy-Item .env.collector.example .env.collector
docker compose --env-file .env.collector -f docker-compose.collector.yml up -d --build
```

生产站点必须置于 HTTPS 域名下，并在微信公众平台配置为小程序业务域名。小程序构建时设置：

```bash
VITE_COLLECTOR_URL=https://collector.example.edu.cn
```

Compose 栈包括采集 Web、API、保留期 worker、PostgreSQL+pgvector 和私有 MinIO。生产对象桶禁止匿名访问。第一版不传递小程序账号或 OpenID。

## 关键接口

- `GET /api/collector/groups`
- `POST /api/collector/drafts`
- `POST /api/collector/drafts/{id}/confirm`
- `GET /api/collector/me`
- `DELETE /api/collector/submissions/{id}`
- `GET /api/collector/review/submissions`
- `POST /api/collector/review/submissions/{id}/decision`
- `GET /api/collector/admin/state`
- `PUT /api/collector/admin/groups/{id}`
- `PUT /api/collector/admin/groups/{id}/targets`
