# 校园食堂运营、菜单与履约来源

覆盖：K01、K02、K06-K08、K27-K31。

## 外部公开来源

| ID | 来源 | 机构 | URL | 状态 | 可参考内容 | 关键边界 |
|---|---|---|---|---|---|---|
| CAMP-001 | 学校食品安全与营养健康管理规定 | 教育部等部门 | https://www.gov.cn/zhengce/content/2019-03/26/content_5377002.htm | public_entry | 学校食品安全责任、营养健康、供餐管理 | 必须确认现行有效版本及地方实施细则 |
| CAMP-002 | 学校食品安全国家标准/政策入口 | 国家卫生健康委 | https://www.nhc.gov.cn/ | public_entry | GB 标准、学校供餐和营养政策入口 | 具体标准逐条核验 |
| CAMP-003 | 食品安全监管公开信息 | 国家市场监督管理总局 | https://www.samr.gov.cn/ | public_entry | 抽检、餐饮服务监管、投诉和召回入口 | 不能替代校内实时状态 |
| CAMP-004 | 学校食堂食品安全管理公开制度示例 | 各高校后勤/食堂官网 | https://www.gov.cn/ | public_entry | 菜单公示、留样、投诉、价格公示等模板 | 学校差异大，只能作为模板，不直接复制事实 |
| CAMP-005 | Codex General Principles of Food Hygiene | FAO/WHO Codex | https://www.fao.org/fao-who-codexalimentarius/codex-texts/codes-of-practice/en/ | public_entry | 卫生管理、HACCP相关制度框架 | 需结合中国法域 |
| CAMP-006 | WHO Five Keys to Safer Food | WHO | https://www.who.int/publications/i/item/9789241594639 | public_entry | 操作端食品安全五要点 | 解释文档，不当作校方制度 |
| CAMP-007 | FDA Food Allergies | FDA | https://www.fda.gov/food/nutrition-food-labeling-and-critical-foods/food-allergies | verified_page | 过敏原、交叉接触、标签和反馈 | 美国法规背景 |
| CAMP-008 | FoodData Central | USDA | https://fdc.nal.usda.gov/ | verified_page | 菜品营养事实参考 | 不替代实际配方 |
| CAMP-009 | WHO Healthy diet | WHO | https://www.who.int/news-room/fact-sheets/detail/healthy-diet | verified_page | 校园健康饮食科普、供餐原则 | 非学校实时运营数据 |
| CAMP-010 | CDC Healthy Weight and Growth | CDC | https://www.cdc.gov/healthy-weight-growth/about/index.html | verified_page | 饮水、饮料、健康餐、活动 | 非中国校园政策 |
| CAMP-011 | 中国消费者协会食品安全/消费维权入口 | 中国消费者协会 | https://www.cca.org.cn/ | public_entry | 投诉、消费权益和食品安全教育入口 | 校内投诉渠道必须由项目配置 |
| CAMP-012 | 学校食品安全与营养健康管理制度地方实施材料 | 地方教育/市场监管部门 | https://www.gov.cn/ | public_entry | 地方制度和应急模板 | 需按学校所在地补齐 |

## 项目必须内部生成的事实

以下不能通过外部知识库替代，必须由后台/实时工具维护：

- 食堂/档口/窗口 ID、位置、楼层、地图、营业时间、无障碍、支付方式（K01）；
- 今日菜单、供应时段、库存、售罄、临时替换、更新时间（K06）；
- 当前价格、套餐组成、加料/半份价格和租户范围（K07）；
- 校内清真/素食窗口、投诉电话、校医/急救渠道和特殊供餐政策（K08/K25/K26/K31）；
- 订单状态、取餐码、取餐点、支付/退款和售罄后的订单处理（K28）；
- 评价审核状态、推荐点击/购买/取消、满意度和失败原因（K29）；
- 真实菜品配方、份量、过敏原确认、营养检测/估算状态（K02-K05/K32）。

外部制度只能提供模板和解释框架，不能制造上述字段值。
