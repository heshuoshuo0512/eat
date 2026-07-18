# RAG、Agent、评测、安全与隐私来源

覆盖：K30-K36。

| ID | 来源 | 维护者 | URL | 状态 | 覆盖 | 许可/备注 |
|---|---|---|---|---|---|---|
| GOV-001 | AI Risk Management Framework 1.0 | NIST | https://www.nist.gov/itl/ai-risk-management-framework | verified_page | AI 风险识别、治理、映射、测量、管理 | 页面已核验；提供 PDF 和 Playbook 入口；自愿框架 |
| GOV-002 | AI RMF Playbook | NIST | https://airc.nist.gov/airmf-resources/playbook/ | public_entry | K35/K36 风险控制与审计 | 官方资源入口 |
| GOV-003 | Generative AI Profile | NIST | https://doi.org/10.6028/NIST.AI.600-1 | public_entry | 生成式 AI 风险、评测和治理 | 官方出版物 |
| GOV-004 | Privacy Framework | NIST | https://www.nist.gov/privacy-framework | verified_page | 敏感健康信息、隐私风险、删除/导出/授权 | 页面已核验；PF 1.1 IPD 当前公开 |
| GOV-005 | OWASP Top 10 for LLM Applications | OWASP | https://owasp.org/www-project-top-10-for-large-language-model-applications/ | verified_page | Prompt Injection、敏感信息泄露、过度代理、过度依赖、供应链 | 页面已核验；项目内容 CC BY-SA 4.0（除另有说明） |
| GOV-006 | OWASP GenAI Security Project | OWASP | https://genai.owasp.org/ | public_entry | Agent/GenAI 安全资源 | 持续更新，使用前锁定版本 |
| GOV-007 | Ragas | Vibrant Labs/open source | https://docs.ragas.io/en/stable/ | verified_page | RAG/Agent/工具调用评测、指标、数据集、实验循环 | 开源项目，许可以仓库 LICENSE 为准 |
| GOV-008 | BEIR | UKP/TU Darmstadt et al. | https://github.com/beir-cellar/beir | verified_page | 检索评测数据集、BM25/稠密/重排评测 | Apache-2.0；适合检索层 benchmark，不是健康知识内容 |
| GOV-009 | MTEB | Hugging Face/community | https://github.com/embeddings-benchmark/mteb | public_entry | embedding/检索模型评测 | 逐数据集核验许可 |
| GOV-010 | NIST Privacy Framework 1.1 IPD | NIST | https://csrc.nist.gov/pubs/cswp/40/nist-privacy-framework-11/ipd | public_entry | K09-K11 隐私风险治理 | 草案/征求意见版本必须标明状态 |
| GOV-011 | NIST AI RMF 1.0 PDF | NIST | https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.100-1.pdf | public_entry | 规则、审计、风险登记 | 官方 PDF |
| GOV-012 | Prompt injection and LLM security resources | OWASP | https://genai.owasp.org/llm-top-10/ | public_entry | K34 工具契约、注入、输出处理 | 以最新版本为准 |
| GOV-013 | LangChain security / retrieval docs | LangChain | https://python.langchain.com/docs/security/ | public_entry | RAG 分层、工具权限和安全实现参考 | 开源文档，版本随库变化 |
| GOV-014 | OpenTelemetry semantic conventions | OpenTelemetry | https://opentelemetry.io/docs/specs/semconv/ | public_entry | K36 审计、trace、工具调用日志 | 作为日志字段设计参考 |
| GOV-015 | W3C PROV | W3C | https://www.w3.org/TR/prov-overview/ | public_entry | 来源、版本、引用链和审计 | 开放 Web 标准 |
| GOV-016 | Model Cards / Datasheets for Datasets | Google/研究社区 | https://arxiv.org/abs/1810.03993 | public_entry | 数据集来源、适用范围、限制和偏差 | 论文/方法参考，不能替代法规 |

## 已核验页面关键事实

### GOV-001 NIST AI RMF

NIST 页面说明 AI RMF 用于管理 AI 对个人、组织和社会的风险，支持设计、开发、使用和评估；提供正式 PDF、Playbook、Generative AI Profile 入口。适合映射到 `sourceIds`、`status`、`reviewDueAt`、风险级别和审计日志。

### GOV-004 NIST Privacy Framework

NIST 将 Privacy Framework 定义为帮助组织通过企业风险管理识别和管理隐私风险的自愿工具。适合 K09-K11 的最小化收集、授权、删除、导出、记忆关闭等治理字段。

### GOV-005 OWASP LLM Top 10

已核验风险包括 Prompt Injection、Insecure Output Handling、Training Data Poisoning、Model DoS、Supply Chain Vulnerabilities、Sensitive Information Disclosure、Insecure Plugin Design、Excessive Agency、Overreliance、Model Theft。项目应至少映射到 Agent 工具权限、来源污染、跨租户访问、下单确认和健康事实不可编造。

### GOV-007 Ragas

当前文档提供实验、指标、数据集、Agent/Tool Use、RAG Evaluation 和 Benchmarking 等入口；可用于 `agent_eval_cases`、`agent_eval_case_runs`、引用忠实度和工具调用正确率。

### GOV-008 BEIR

GitHub README 表明 BEIR 是异构信息检索 benchmark，提供 15+ 数据集和统一评测框架，仓库许可 Apache-2.0。它只能评测检索系统，不能作为健康知识来源。
