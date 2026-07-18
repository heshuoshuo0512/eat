# 总来源索引与覆盖矩阵

采集日期：2026-07-16。`verified_page` 表示本次通过读取工具成功打开并核验；`public_entry` 表示发现了公开入口但未下载全文；`restricted` 表示访问受限或需注册；`internal_required` 表示只能由项目生成。

## 按知识域覆盖

| 知识域 | 外部可用来源 | 项目内部必需事实 | 当前状态 |
|---|---|---|---|
| K01 食堂/档口/窗口 | 校园制度模板、WHO/食品安全操作框架 | 食堂层级、位置、营业、拥挤度 | internal_required |
| K02 菜品基础事实 | 食物分类词汇、食物数据库 | 菜名、食材、价格、餐别、状态 | internal_required |
| K03 菜品营养事实 | USDA FDC、FAO INFOODS、CNF/CoFID/AUSNUT | 校内配方、份量、检测/估算和审核 | public_entry + internal_required |
| K04 配方份量加工 | 食物成分数据库方法 | 供应商配方、熟重、生重、油酱和修正项 | internal_required |
| K05 过敏原禁忌 | FDA、NIAID、CDC、Codex | 每道菜未知/已确认过敏原和交叉污染 | verified_page + internal_required |
| K06 菜单供应售罄 | 运营制度模板 | 今日菜单、库存、售罄、供应时间 | internal_required |
| K07 价格预算套餐 | 通用运营模板 | 当前价格、预算口径、套餐和加料 | internal_required |
| K08 食品安全校园制度 | WHO、Codex、中国政府入口 | 学校/地方现行制度和投诉渠道 | public_entry + internal_required |
| K09 健康档案 | 隐私框架/最小化原则 | 用户授权档案 | internal_required |
| K10 偏好行为 | 隐私和推荐治理原则 | 用户明确偏好和真实反馈 | internal_required |
| K11 会话记忆 | NIST Privacy Framework | 会话与记忆生命周期 | internal_required |
| K12 基础营养素 | WHO、CDC、NIH ODS、FDC | 中文学生解释、版本和引用 | verified_page + public_entry |
| K13 食物分类食材 | INFOODS、LanguaL、FDC | 校园俗称、复合菜拆解 | public_entry + internal_required |
| K14 计算单位换算 | FDC schema、DRI参考 | 项目公式、单位、缺失传播 | public_entry + internal_required |
| K15 份量饱腹 | WHO、CDC、FDC | 校内标准份和动作修正 | verified_page + internal_required |
| K16 餐盘搭配 | WHO/中国膳食指南/FAO | 真实菜单搭配规则 | verified_page + internal_required |
| K17 互补替换 | 营养指南 | 校内替换候选和价格供应 | public_entry + internal_required |
| K18 餐别场景 | CDC/WHO/校园制度模板 | 菜单供应时间和校园场景 | verified_page + internal_required |
| K19 减脂 | CDC、WHO、美国膳食指南 | 项目保守规则和个体边界 | verified_page + public_entry |
| K20 增肌恢复 | ACSM、ISSN、WHO | 训练场景和真实菜单 | public_entry + internal_required |
| K21 维持均衡 | WHO、CDC、膳食指南 | 项目解释与反馈 | verified_page + public_entry |
| K22 特殊场景 | CDC、WHO活动/睡眠入口 | 考试、熬夜、赶课、天气、排队 | public_entry + internal_required |
| K23 微量营养素 | NIH ODS、WHO | 非诊断提醒和转介 | restricted + public_entry |
| K24 饮水饮料零食 | WHO、CDC | 校内饮料和零食事实 | verified_page + public_entry |
| K25 过敏特殊人群 | FDA、NIAID、CDC、NHS | 校内确认、急救渠道 | verified_page + internal_required |
| K26 医疗边界 | NIAID、NHS、WHO | 校医/医院/急救转介配置 | public_entry + internal_required |
| K27 天气拥挤出行 | 通用场景原则 | 实时天气、拥挤、距离 | internal_required |
| K28 订单履约 | 运营模板 | 订单、支付、退款、取餐 | internal_required |
| K29 评价反馈 | 评测/推荐治理方法 | 审核状态、反馈、转化数据 | internal_required |
| K30 RAG健康科普 | WHO、CDC、FDA、Ragas引用评测 | 审核版文档与引用 | verified_page + internal_required |
| K31 RAG校园运营 | 中国校园制度、WHO/Codex | 校内制度和FAQ | public_entry + internal_required |
| K32 RAG菜品事实 | FDC/食物数据库仅作参考 | 真实菜品文档和实时状态 | internal_required |
| K33 FAQ | Ragas/评测方法 | 本项目真实问法与标准答 | internal_required |
| K34 Agent契约权限 | OWASP、NIST、OpenTelemetry | 工具 schema、角色、租户、确认 | verified_page + internal_required |
| K35 红队评测 | NIST、OWASP、Ragas、BEIR | 项目案例、指标和运行结果 | verified_page + internal_required |
| K36 来源版本审计 | NIST、W3C PROV、OpenTelemetry | 责任人、版本、审核链和日志 | verified_page + internal_required |

## 来源文件

- `../../01_nutrition_guidelines/sources.md`
- `../../02_food_composition/sources.md`
- `../../03_food_safety_allergy/sources.md`
- `../../04_sports_weight/sources.md`
- `../../05_campus_operations/sources.md`
- `../../06_rag_agent_governance/sources.md`
- `../../07_project_internal/README.md`
