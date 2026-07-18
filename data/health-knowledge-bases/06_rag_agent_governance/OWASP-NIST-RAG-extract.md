# RAG/Agent 治理来源核验摘录

页面核验日期：2026-07-16

## NIST AI RMF

来源：https://www.nist.gov/itl/ai-risk-management-framework

NIST 将 AI RMF 定位为用于管理 AI 对个人、组织和社会风险的自愿框架，覆盖设计、开发、使用和评估；页面提供 AI RMF 1.0 PDF、Playbook 和 Generative AI Profile 入口。

项目映射：`sourceIds`、版本、风险等级、审核状态、复核日期、引用链、AI 日志、评测运行记录。

## NIST Privacy Framework

来源：https://www.nist.gov/privacy-framework

NIST Privacy Framework 用于通过企业风险管理识别和管理隐私风险，保护个人。项目映射：健康档案最小化收集、明确授权、用户查看/修改/删除/导出、记忆关闭、保存期限。

## OWASP Top 10 for LLM Applications

来源：https://owasp.org/www-project-top-10-for-large-language-model-applications/

已核验的风险：Prompt Injection、不安全输出处理、训练数据投毒、模型拒绝服务、供应链漏洞、敏感信息泄露、不安全插件设计、过度代理、过度依赖、模型窃取。

项目映射：

- 工具由服务端权限控制，RAG 不能绕过租户/角色鉴权。
- 下单只能生成待确认提议，不允许 Agent 直接下单。
- 价格、库存、菜单、订单和过敏事实必须来自工具/数据库。
- 检索来源和外部文档需版本化，不能未经审核发布。

## Ragas

来源：https://docs.ragas.io/en/stable/

文档提供实验、指标、数据集、Agent/Tool Use、RAG Evaluation、Benchmarking 等入口。项目映射：事实准确率、可购买率、过敏排除准确率、引用忠实度、工具调用正确率、医疗越界率、权限违规率和回退成功率。

## BEIR

来源：https://github.com/beir-cellar/beir

BEIR 是异构信息检索 benchmark，提供 15+ 数据集和统一评测框架，仓库许可 Apache-2.0。仅用于评测检索层，不作为健康知识内容。
