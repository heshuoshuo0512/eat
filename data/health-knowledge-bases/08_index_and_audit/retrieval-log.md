# 检索与核验日志

- 日期：2026-07-16
- 目标：依据 `docs/健康知识库清单.md` 搜集公开健康知识库及治理资料。

## 成功核验

- WHO Healthy diet：页面成功读取，核验四项原则、糖/脂肪/蛋白质/钠钾/纤维/微量营养素和校园健康环境相关内容。
- USDA FoodData Central：页面成功读取，核验数据类型、更新频率入口和 CC0 1.0 公共领域说明。
- FAO INFOODS Tables and Databases：页面成功读取，核验其为全球食物成分表目录，且许多表不由 INFOODS 秘书处持有、部分可能绝版。
- U.S. FDA Food Allergies：页面成功读取，核验九大过敏原、交叉接触、标签和严重反应转介提示。
- CDC Healthy Weight and Growth：页面成功读取，核验健康饮食、活动、睡眠、压力、含糖饮料和反快速节食内容。
- NIST AI RMF：页面成功读取，核验 AI RMF 1.0 PDF、Playbook、Generative AI Profile 和风险管理定位。
- NIST Privacy Framework：页面成功读取，核验隐私风险管理定位及 PF 1.1 IPD 入口。
- OWASP LLM Top 10：页面成功读取，核验十类大模型应用风险和 CC BY-SA 4.0 说明。
- Ragas 文档：页面成功读取，核验实验、指标、数据集、Agent/Tool Use、RAG Evaluation 等能力入口。
- BEIR GitHub：页面成功读取，核验 15+ 检索数据集/统一评测框架和 Apache-2.0 许可。

## 未成功读取/需后续补核验

- `https://www.gov.cn/xinwen/2022-05/19/content_5691504.htm` 返回 404；中国居民膳食指南页面应改用中国营养学会官网 `https://dg.cnsoc.org/` 或官方现行页面重新核验。
- NIH ODS factsheets 列表返回 403；仅记录公开入口，不声称已获取全文。
- web_search 工具连接失败；dataPro-search 返回方舟鉴权失败；不能据此编造搜索结果。
- 多个中国政府/学校入口只记录为 `public_entry`，具体标准、版本和地方适用范围尚未逐条下载核验。

## 采集策略

不下载大数据包、不镜像受版权保护整站；优先保存入口、版本、许可、字段说明和必要摘录。后续导入真实数据时，逐条建立 K36 来源记录，并由人工审核。
