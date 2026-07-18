# 食物成分与营养数据源

覆盖：K03、K04、K13、K14、K15、K32。

| ID | 数据源 | 机构/维护者 | 入口 | 状态 | 形式 | 许可/限制 | 项目使用边界 |
|---|---|---|---|---|---|---|---|
| FDC-001 | FoodData Central | USDA ARS/NAL | https://fdc.nal.usda.gov/ | verified_page | 网页、下载、API 文档入口 | 数据为 Public Domain，CC0 1.0；建议署名 USDA FoodData Central | 可作基础食材参考；不能替代校内配方和实测 |
| FDC-002 | FoodData Central Downloads | USDA ARS/NAL | https://fdc.nal.usda.gov/download-datasets | public_entry | CSV/数据下载 | 同上；下载包可能较大，按需获取 | 先保存 schema/版本，再选择性导入 |
| FDC-003 | Foundation Foods | USDA ARS | https://fdc.nal.usda.gov/food-search?type=Foundation | public_entry | 分析/元数据 | CC0 体系；数据更新时间以页面为准（当前页面称每年4月/10月） | 优先用于未经加工食材和分析字段 |
| FDC-004 | SR Legacy Foods | USDA | https://fdc.nal.usda.gov/food-search?type=SR%20Legacy | public_entry | 历史营养数据 | 页面称最终更新 2018 | 仅作历史参考，必须标记版本/日期 |
| FDC-005 | FNDDS | USDA | https://fdc.nal.usda.gov/food-search?type=Survey%20(FNDDS) | public_entry | NHANES 食物调查数据 | 按 USDA 页面许可 | 可参考常见食物，但不等于学校菜品 |
| FDC-006 | Branded Foods | USDA/GDSN/Label Insight | https://fdc.nal.usda.gov/food-search?type=Branded | public_entry | 品牌标签数据 | 数据源/更新时间复杂；需遵循页面条款 | 不能直接用于非包装食堂菜 |
| FDC-007 | FDC API | USDA | https://fdc.nal.usda.gov/api-guide.html | public_entry | REST API | 需要 API key；额度与条款按官方说明 | 服务端调用需缓存来源和查询时间 |
| FDC-008 | INFOODS Tables and Databases | FAO INFOODS | https://www.fao.org/infoods/infoods/tables-and-databases/en/ | verified_page | 全球食物成分表目录、地区数据库入口 | FAO 页面明确说明很多表不由秘书处持有，部分绝版；不可声称全部可下载 | 作为目录发现层和数据源追踪 |
| FDC-009 | FAO/INFOODS Databases | FAO INFOODS | https://www.fao.org/infoods/infoods/tables-and-databases/faoinfoods-databases/en/ | public_entry | 国际数据库 | 每个数据库单独核验许可 | 记录来源、版本和地区 |
| FDC-010 | Canadian Nutrient File | Health Canada | https://food-nutrition.canada.ca/cnf-fce/index-eng.jsp | public_entry | 食物成分查询/下载入口 | 按加拿大政府条款 | 作为英文交叉参考 |
| FDC-011 | UK CoFID | UK government | https://www.gov.uk/government/publications/composition-of-foods-integrated-dataset-cofid | public_entry | 下载数据/说明 | GOV.UK 数据与版权条款 | 注意地区食物差异 |
| FDC-012 | AUSNUT | Food Standards Australia New Zealand | https://www.foodstandards.gov.au/science-data/food-nutrient-databases/ausnut | public_entry | 澳大利亚食物营养数据库 | 依 FSANZ 条款 | 作为交叉参考，不作为中国菜品事实 |
| FDC-013 | Open Food Facts | Open Food Facts | https://world.openfoodfacts.org/data | public_entry | API、CSV、JSON、图片 | ODbL 数据库许可；图片/品牌字段另有许可 | 只适合包装食品标签；必须保留许可和来源 |
| FDC-014 | LanguaL | European LanguaL | https://www.langual.org/ | public_entry | 食品描述/分类词汇 | 词汇许可按项目说明 | 可用于 K13 食物分类和同义词，不提供完整营养事实 |

## 已核验页面事实

- FDC 首页列出 Foundation、SR Legacy、FNDDS、Experimental、Branded 等不同数据类型；更新频率不同，不能混成一个无版本表。
- FDC 页面明确说明数据为公共领域、CC0 1.0，无需许可，但建议注明来源并通知 USDA 使用情况。
- FAO INFOODS 页面是目录，不承诺每张表都可直接下载；应把“目录入口”和“实际可获取数据”分开。

## 导入字段最低要求

`foodId`, `foodName`, `sourceDataset`, `sourceUrl`, `datasetVersion`, `servingSize`, `servingUnit`, `basis`（per100g/perServing）, `calories`, `protein`, `fat`, `carbs`, `fiber`, `sodium`, `sugar`, `calcium`, `iron`, `valueStatus`, `confidence`, `license`, `retrievedAt`。

外部食物数据进入菜品事实前，必须经过配方、份量、加工方式、过敏原和审核补充；缺失不填 0。
