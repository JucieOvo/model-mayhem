---
id: model-mayhem-content-sources
author: JucieOvo
project: modelmayhem
updated: 2026-09-13
status: active
---

# 内容来源与社区贡献

## 范围

本文件记录 Model Mayhem 的游戏内容和文档所使用的外部资料及其来源状态。

本文件不记录：

- 对项目本身有代码或文档贡献的开发者，见 `CONTRIBUTORS.md`。
- 第三方软件依赖，见 `NOTICE` 与 `THIRD_PARTY_LICENSES`。

本项目与下列论文作者、社区用户、公司、平台和组织不存在隶属、合作或背书关系。
名称和链接只用于说明来源、历史事实或技术概念。

## 来源分类

| 类别 | 本项目中的含义 | 当前处理方式 |
|---|---|---|
| 直接引用的受版权材料 | 复制外部正文、图表、图片、音视频或其他受保护表达 | 本次审计未发现直接复制的外部正文、论文图表或媒体文件 |
| 据公开事实二次创作的卡面文本 | 根据官方页面、论文摘要或公开资料重新撰写的描述和游戏语义 | 139 张现实内容卡采用此方式 |
| 社区梗的灵感来源 | 用公开讨论识别行业焦虑、争议和反复出现的表达主题 | 22 个梗簇、84 张卡，不复制 Hacker News 评论，只作主题级归纳 |
| 仅为事实来源 | 用于核实名称、时间、产品关系或技术方向，不进入文案表达 | arXiv 论文和厂商、平台官方资料 |

## 核验状态

- 内容快照日期：2026-09-12。
- 来源清单审计日期：2026-09-13。
- `已核实`：项目文件内存在直接链接，并通过官方 API、页面解析或 HTTP 响应确认。
- `自动访问受阻`：链接仍在原始来源中，但自动请求返回 401、403 或 503，需要人工浏览器复核。
- `待核实`：现有内容缺少可验证的外部来源，不能作为公开发布的事实依据。
- 网络可访问性只说明链接状态，不表示已经确认全部页面内容的准确性和授权范围。

## 总量

| 项目 | 数量 | 状态 |
|---|---:|---|
| 现实内容卡 | 139 | 84 张现役卡和 55 张谱系卡 |
| Hacker News 讨论 ID | 39 | 全部通过 Hacker News Firebase API 确认为有效评论 |
| 社区梗簇 | 22 | 每个梗簇均有关联讨论，但讨论样本不能证明普遍行业共识 |
| 卡面直接引用的 arXiv 论文 | 53 | 53 个页面可访问，许可证已归档 |
| 游戏内容范围内的唯一外部 URL | 145 | 138 个已通过对应 API 或页面响应核实，7 个 OpenAI 深链自动访问受阻 |
| 仓库文档中的唯一 URL 字符串 | 271 | 267 个为候选外部来源，4 个为示例、局域网或占位地址 |
| 项目自有视觉和媒体素材 | 0 | 未发现位图、音频、视频或字体资源 |

## 一、公开研究论文与技术资料

### 1.1 卡面直接引用的 arXiv 论文

论文只用于核对技术名称、历史关系和方法概念。项目没有复制论文正文、图表或数据集，
除非单独标注，不把论文作为游戏能力数值或产品排名的依据。

#### arXiv 非独占分发许可

| 论文 | 来源 | 项目用途 |
|---|---|---|
| Neural Machine Translation by Jointly Learning to Align and Translate | [1409.0473](https://arxiv.org/abs/1409.0473) | Attention 机制技术卡 |
| Distilling the Knowledge in a Neural Network | [1503.02531](https://arxiv.org/abs/1503.02531) | 知识蒸馏技术卡 |
| Deep Residual Learning for Image Recognition | [1512.03385](https://arxiv.org/abs/1512.03385) | 残差连接谱系卡 |
| Layer Normalization | [1607.06450](https://arxiv.org/abs/1607.06450) | LayerNorm 谱系卡 |
| Outrageously Large Neural Networks: The Sparsely-Gated Mixture-of-Experts Layer | [1701.06538](https://arxiv.org/abs/1701.06538) | 混合专家技术卡 |
| Deep reinforcement learning from human preferences | [1706.03741](https://arxiv.org/abs/1706.03741) | RLHF 技术卡 |
| Attention Is All You Need | [1706.03762](https://arxiv.org/abs/1706.03762) | Transformer 与注意力谱系卡 |
| SentencePiece: A simple and language independent subword tokenizer and detokenizer for Neural Text Processing | [1808.06226](https://arxiv.org/abs/1808.06226) | SentencePiece 谱系卡 |
| Music Transformer | [1809.04281](https://arxiv.org/abs/1809.04281) | 相对位置编码谱系卡 |
| BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding | [1810.04805](https://arxiv.org/abs/1810.04805) | BERT 与 WordPiece 谱系卡 |
| Exploring the Limits of Transfer Learning with a Unified Text-to-Text Transformer | [1910.10683](https://arxiv.org/abs/1910.10683) | T5 谱系卡 |
| Fast Transformer Decoding: One Write-Head is All You Need | [1911.02150](https://arxiv.org/abs/1911.02150) | Multi-Query Attention 谱系卡 |
| Scaling Laws for Neural Language Models | [2001.08361](https://arxiv.org/abs/2001.08361) | 缩放规律技术卡 |
| On Layer Normalization in the Transformer Architecture | [2002.04745](https://arxiv.org/abs/2002.04745) | Pre-LN 谱系卡 |
| Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks | [2005.11401](https://arxiv.org/abs/2005.11401) | RAG 技术卡 |
| Language Models are Few-Shot Learners | [2005.14165](https://arxiv.org/abs/2005.14165) | GPT-3 与 Few-Shot 谱系卡 |
| Switch Transformers: Scaling to Trillion Parameter Models with Simple and Efficient Sparsity | [2101.03961](https://arxiv.org/abs/2101.03961) | 专家路由技术卡 |
| Learning Transferable Visual Models From Natural Language Supervision | [2103.00020](https://arxiv.org/abs/2103.00020) | CLIP 与多模态融合卡 |
| LoRA: Low-Rank Adaptation of Large Language Models | [2106.09685](https://arxiv.org/abs/2106.09685) | LoRA 技术卡 |
| Train Short, Test Long: Attention with Linear Biases Enables Input Length Extrapolation | [2108.12409](https://arxiv.org/abs/2108.12409) | ALiBi 谱系卡 |
| Training language models to follow instructions with human feedback | [2203.02155](https://arxiv.org/abs/2203.02155) | InstructGPT 与 RLHF 谱系卡 |
| Training Compute-Optimal Large Language Models | [2203.15556](https://arxiv.org/abs/2203.15556) | Chinchilla 技术卡 |
| FlashAttention: Fast and Memory-Efficient Exact Attention with IO-Awareness | [2205.14135](https://arxiv.org/abs/2205.14135) | FlashAttention 技术卡 |
| Scaling Vision Transformers to 22 Billion Parameters | [2302.05442](https://arxiv.org/abs/2302.05442) | QK-Norm 谱系卡 |
| Llama 2: Open Foundation and Fine-Tuned Chat Models | [2307.09288](https://arxiv.org/abs/2307.09288) | Llama 2 谱系卡 |
| DeepSeekMoE: Towards Ultimate Expert Specialization in Mixture-of-Experts Language Models | [2401.06066](https://arxiv.org/abs/2401.06066) | DeepSeekMoE 谱系卡 |
| DeepSeek-Coder: When the Large Language Model Meets Programming - The Rise of Code Intelligence | [2401.14196](https://arxiv.org/abs/2401.14196) | DeepSeek-Coder 谱系卡 |
| DeepSeekMath: Pushing the Limits of Mathematical Reasoning in Open Language Models | [2402.03300](https://arxiv.org/abs/2402.03300) | GRPO 技术卡 |
| DeepSeek-V2: A Strong, Economical, and Efficient Mixture-of-Experts Language Model | [2405.04434](https://arxiv.org/abs/2405.04434) | DeepSeek-V2 与 MLA 谱系卡 |
| Qwen2 Technical Report | [2407.10671](https://arxiv.org/abs/2407.10671) | Qwen2 谱系卡 |
| DeepSeek-V3 Technical Report | [2412.19437](https://arxiv.org/abs/2412.19437) | DeepSeek-V3 谱系卡 |
| DeepSeek-R1: Incentivizing Reasoning Capability in LLMs via Reinforcement Learning | [2501.12948](https://arxiv.org/abs/2501.12948) | DeepSeek-R1 谱系卡 |

本组许可证为 arXiv 非独占分发许可。公开项目建议保留论文题名、作者信息和 arXiv 链接。

#### CC BY 4.0

| 论文 | 来源 | 项目用途 |
|---|---|---|
| Neural Machine Translation of Rare Words with Subword Units | [1508.07909](https://arxiv.org/abs/1508.07909) | BPE 与字节级 BPE 谱系卡 |
| GLaM: Efficient Scaling of Language Models with Mixture-of-Experts | [2112.06905](https://arxiv.org/abs/2112.06905) | GLaM 谱系卡 |
| Chain-of-Thought Prompting Elicits Reasoning in Large Language Models | [2201.11903](https://arxiv.org/abs/2201.11903) | Chain-of-Thought 技术卡 |
| PaLM: Scaling Language Modeling with Pathways | [2204.02311](https://arxiv.org/abs/2204.02311) | PaLM 谱系卡 |
| OPT: Open Pre-trained Transformer Language Models | [2205.01068](https://arxiv.org/abs/2205.01068) | OPT 谱系卡 |
| ReAct: Synergizing Reasoning and Acting in Language Models | [2210.03629](https://arxiv.org/abs/2210.03629) | ReAct 技术卡 |
| Fast Inference from Transformers via Speculative Decoding | [2211.17192](https://arxiv.org/abs/2211.17192) | 推测解码技术卡 |
| Constitutional AI: Harmlessness from AI Feedback | [2212.08073](https://arxiv.org/abs/2212.08073) | Constitutional AI 谱系卡 |
| LLaMA: Open and Efficient Foundation Language Models | [2302.13971](https://arxiv.org/abs/2302.13971) | Llama 1 谱系卡 |
| GQA: Training Generalized Multi-Query Transformer Models from Multi-Head Checkpoints | [2305.13245](https://arxiv.org/abs/2305.13245) | GQA 技术卡 |
| QLoRA: Efficient Finetuning of Quantized LLMs | [2305.14314](https://arxiv.org/abs/2305.14314) | QLoRA 技术卡 |
| Direct Preference Optimization: Your Language Model is Secretly a Reward Model | [2305.18290](https://arxiv.org/abs/2305.18290) | DPO 技术卡 |
| RLAIF vs. RLHF: Scaling Reinforcement Learning from Human Feedback with AI Feedback | [2309.00267](https://arxiv.org/abs/2309.00267) | RLAIF 谱系卡 |
| Efficient Memory Management for Large Language Model Serving with PagedAttention | [2309.06180](https://arxiv.org/abs/2309.06180) | PagedAttention 技术卡 |
| Qwen Technical Report | [2309.16609](https://arxiv.org/abs/2309.16609) | Qwen 1 谱系卡 |
| Mistral 7B | [2310.06825](https://arxiv.org/abs/2310.06825) | Mistral 7B 谱系卡 |
| Mamba: Linear-Time Sequence Modeling with Selective State Spaces | [2312.00752](https://arxiv.org/abs/2312.00752) | 状态空间模型技术卡 |
| Mixtral of Experts | [2401.04088](https://arxiv.org/abs/2401.04088) | Mixtral 谱系卡 |
| ChatGLM: A Family of Large Language Models from GLM-130B to GLM-4 All Tools | [2406.12793](https://arxiv.org/abs/2406.12793) | GLM-4 谱系卡 |

本组必须保留作者、题名、来源和许可证标识；如再分发或改编论文材料，应逐项复核 CC BY
要求。

#### CC BY-NC-ND 4.0

| 论文 | 来源 | 项目用途 |
|---|---|---|
| RoFormer: Enhanced Transformer with Rotary Position Embedding | [2104.09864](https://arxiv.org/abs/2104.09864) | RoPE 技术卡 |
| Kimi k1.5: Scaling Reinforcement Learning with LLMs | [2501.12599](https://arxiv.org/abs/2501.12599) | Kimi K1.5 谱系卡 |

这两篇论文标注为非商业、禁止演绎许可。项目目前只使用技术名称和公开事实作为事实来源，
没有复制论文正文、图表或媒体。发布商业版本前必须再次确认卡面文案和传播方式是否超出
许可边界。

### 1.2 游戏研发研究文档中的论文

以下论文用于游戏系统、平衡和验证方法研究，不直接作为现实内容卡的事实依据。

| 论文 | 来源 | 许可证 | 项目用途 |
|---|---|---|---|
| Categorizing Variants of Goodhart's Law | [1803.04585](https://arxiv.org/abs/1803.04585) | CC BY-NC-SA 4.0 | 指标设计和副作用分析 |
| ChatGPT and Other Large Language Models as Evolutionary Engines for Online Interactive Collaborative Game Design | [2303.02155](https://arxiv.org/abs/2303.02155) | CC BY-NC-ND 4.0 | AI 游戏设计边界 |
| Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena | [2306.05685](https://arxiv.org/abs/2306.05685) | arXiv 非独占分发许可 | 自动评审偏差 |
| GameGPT: Multi-agent Collaborative Framework for Game Development | [2310.08067](https://arxiv.org/abs/2310.08067) | CC BY 4.0 | 多 Agent 游戏开发研究 |
| How Far Are We on the Decision-Making of LLMs? | [2403.11807](https://arxiv.org/abs/2403.11807) | arXiv 非独占分发许可 | LLM 游戏决策评测 |
| Game Generation via Large Language Models | [2404.08706](https://arxiv.org/abs/2404.08706) | arXiv 非独占分发许可 | 游戏生成研究 |
| A Taxonomy of Collectible Card Games from a Game-Playing AI Perspective | [2410.06299](https://arxiv.org/abs/2410.06299) | CC BY 4.0 | 卡牌游戏分类 |
| Self-Preference Bias in LLM-as-a-Judge | [2410.21819](https://arxiv.org/abs/2410.21819) | CC BY 4.0 | 自动评审偏差 |
| Agentic Retrieval-Augmented Generation: A Survey on Agentic RAG | [2501.09136](https://arxiv.org/abs/2501.09136) | arXiv 非独占分发许可 | Agent 检索架构 |
| LLMs are the Ideal Candidate for Mixed-Initiative Game Design Pillar Workflows | [2605.09767](https://arxiv.org/abs/2605.09767) | CC BY 4.0 | 混合 Initiative 设计流程 |

三份内部研究文档还引用了 42 个 DOI 来源，包含会议论文、期刊论文和专业书籍。
这些内部文档按发行边界不进入公开源码包，文件名分别为
`docs/2026-09-12-游戏设计AI外部知识与Skills研究.md`、
`docs/2026-09-12-游戏研发决策手册.md` 和
`docs/2026-09-12-科技树爬线里程碑与卡牌平衡研究.md`。

DOI 来源多数由出版方保留版权。项目只保留书目信息和方法归纳，没有复制全文、图表或大段
原文。公开商业发布前仍需按单篇许可复核。

## 二、公开产品与平台资料

以下页面用于核对组织介绍、模型名称、产品关系和历史事件。项目没有使用其标志、宣传图、
视频或网页排版，也没有把厂商宣传声明写成独立验证结论。

| 来源方 | 页面 | 项目用途 | 自动状态 |
|---|---|---|---|
| OpenAI | [API Models](https://developers.openai.com/api/docs/models)、[GPT-2](https://openai.com/index/better-language-models/)、[ChatGPT](https://openai.com/index/chatgpt/)、[Function Calling](https://openai.com/index/function-calling-and-other-api-updates/)、[GPT-4](https://openai.com/index/gpt-4-research/)、[GPT-4o](https://openai.com/index/hello-gpt-4o/)、[o1 Preview](https://openai.com/index/introducing-openai-o1-preview/)、[GPT-1](https://openai.com/index/language-unsupervised/)、[Function Calling Guide](https://platform.openai.com/docs/guides/function-calling) | 组织、模型和工具调用卡 | 2 个通过，7 个自动访问受阻 |
| Anthropic | [Company](https://www.anthropic.com/company)、[Claude 1](https://www.anthropic.com/news/introducing-claude)、[Claude 2](https://www.anthropic.com/news/claude-2)、[Claude 3](https://www.anthropic.com/news/claude-3-family)、[Tool Use](https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/overview)、[Claude Models](https://docs.claude.com/en/docs/about-claude/models/overview) | 组织、模型和安全路线卡 | 已通过 |
| Google DeepMind | [Models](https://deepmind.google/models/)、[Gemma 4](https://deepmind.google/models/gemma/gemma-4/)、[Gemini](https://deepmind.google/technologies/gemini/)、[Gemini Pro](https://deepmind.google/technologies/gemini/pro/)、[Gemini API Models](https://ai.google.dev/gemini-api/docs/models) | 组织、Gemini 和 Gemma 卡 | 已通过 |
| Meta AI | [Llama](https://ai.meta.com/llama/)、[Llama 3](https://ai.meta.com/blog/meta-llama-3/)、[Llama 4](https://ai.meta.com/blog/llama-4-multimodal-intelligence/) | 组织、Llama 和开放权重路线卡 | 已通过 |
| Microsoft AI | [Microsoft AI](https://microsoft.ai/) | 组织与企业平台卡 | 已通过 |
| Mistral AI | [Models](https://docs.mistral.ai/getting-started/models/models_overview/) | 组织、Mistral、Magistral 和 Devstral 卡 | 已通过 |
| xAI | [Grok](https://x.ai/news/grok)、[Grok 2](https://x.ai/news/grok-2)、[Grok 3](https://x.ai/news/grok-3)、[Models](https://docs.x.ai/docs/models) | 组织、Grok 和多模态产品卡 | 已通过 |
| DeepSeek | [API](https://api-docs.deepseek.com/)、[Pricing](https://api-docs.deepseek.com/quick_start/pricing) | 组织、模型和价格事实 | 已通过 |
| Alibaba Cloud Qwen | [Model Studio](https://www.alibabacloud.com/help/en/model-studio/models)、[QwQ 32B](https://qwenlm.github.io/blog/qwq-32b/) | Qwen、QwQ 和云平台卡 | 已通过 |
| Moonshot AI | [Kimi API](https://platform.moonshot.ai/docs/introduction) | 组织、Kimi 和长上下文卡 | 已通过 |
| Zhipu AI | [Z.AI Docs](https://docs.z.ai/) | 组织、GLM 和开发平台卡 | 已通过 |
| ByteDance Seed | [Seed](https://seed.bytedance.com/en/)、[Seedance](https://seed.bytedance.com/en/seedance) | 组织、Seedance 和 Seedream 卡 | 已通过 |
| Baidu AI | [Qianfan and Wenxin](https://cloud.baidu.com/doc/WENXINWORKSHOP/index.html) | 组织与文心卡 | 已通过 |
| Tencent Hunyuan | [Hunyuan](https://cloud.tencent.com/document/product/1729) | 组织与混元卡 | 已通过 |
| MiniMax | [News](https://minimax.io/news) | 组织、M3 和视频生成卡 | 已通过 |
| Hugging Face | [Hub](https://huggingface.co/docs/hub/index)、[SmolLM3](https://huggingface.co/blog/smollm3)、[KV Cache](https://huggingface.co/docs/transformers/en/kv_cache)、[Quantization](https://huggingface.co/docs/transformers/en/quantization/overview)、[TRL SFT](https://huggingface.co/docs/trl/sft_trainer) | 平台、开放模型和训练系统卡 | 已通过 |
| ModelScope | [Docs](https://modelscope.cn/docs) | 平台与开放模型生态卡 | 已通过 |
| OpenRouter | [Quickstart](https://openrouter.ai/docs/quickstart) | 模型路由平台卡 | 已通过 |
| Ollama | [Docs](https://docs.ollama.com/) | 本地运行平台卡 | 已通过 |
| NVIDIA | [NIM](https://docs.nvidia.com/nim/) | 基础设施与推理平台卡 | 已通过 |
| AMD | [ROCm](https://rocm.docs.amd.com/) | 基础设施与开放计算卡 | 已通过 |
| AWS | [Bedrock](https://docs.aws.amazon.com/bedrock/) | 企业模型平台卡 | 已通过 |
| Huawei | [Ascend Documentation](https://www.hiascend.com/document) | 基础设施与 Ascend 卡 | 已通过 |
| Model Context Protocol | [Documentation](https://modelcontextprotocol.io/) | MCP 技术卡 | 已通过 |

权利状态说明：以上页面和页面内材料的权利归各来源方。项目只引用公开事实并保留原链接；
商标和产品名称按指称性使用处理。商业发布前仍需完成商标和页面条款复核。

## 三、社区梗与行业共识

### 3.1 使用方式

`community-banter.json` 把公开讨论归纳为 22 个梗簇，再为 84 张卡提供调侃主题。
项目没有复制评论正文。梗簇名称和观察是项目编辑后的主题描述，不代表来源机构立场，
也不能由少量帖子推出“行业共识”。

Hacker News 评论由各自用户创作，Y Combinator 的服务条款适用于站点。公开文档保留
评论链接、用户名和日期，建议发布时继续保留这些信息。

### 3.2 梗簇与讨论

| 梗簇 | 观察用途 | Hacker News 评论 |
|---|---|---|
| 模型弃用焦虑 | 旧模型退役和使用稳定性 | [48557888](https://news.ycombinator.com/item?id=48557888) by throwarayes, 2026-06-16；[47863547](https://news.ycombinator.com/item?id=47863547) by kamranjon, 2026-04-22 |
| 额度限制 | Agent 套餐和周额度变化 | [48883192](https://news.ycombinator.com/item?id=48883192) by sunaookami, 2026-07-12；[48887004](https://news.ycombinator.com/item?id=48887004) by PaiDxng, 2026-07-13 |
| 版本命名通胀 | 相近名称和版本差异 | [49665493](https://news.ycombinator.com/item?id=49665493) by minimaxir, 2026-09-11；[49665598](https://news.ycombinator.com/item?id=49665598) by nater5000, 2026-09-11 |
| 发布延期 | 预览、延期和路线图 | [49615006](https://news.ycombinator.com/item?id=49615006) by clement_b, 2026-09-08 |
| 本地模型偏好 | 本地部署、量化和硬件 | [43828774](https://news.ycombinator.com/item?id=43828774) by jasonjmcghee, 2025-04-29；[49303741](https://news.ycombinator.com/item?id=49303741) by yalok, 2026-08-14 |
| 许可证解释 | 开放权重和许可条件 | [44833530](https://news.ycombinator.com/item?id=44833530) by wkat4242, 2025-08-08 |
| 推理循环 | Agent 重复思考或工具循环 | [49664337](https://news.ycombinator.com/item?id=49664337) by celrod, 2026-09-11 |
| 便宜 Agent | 价格变化和模型切换 | [48752527](https://news.ycombinator.com/item?id=48752527) by echelon, 2026-07-01；[48738233](https://news.ycombinator.com/item?id=48738233) by 0xbadcafebee, 2026-06-30 |
| 长上下文与 RAG | 长上下文和检索路线争论 | [48814267](https://news.ycombinator.com/item?id=48814267) by wolvoleo, 2026-07-07；[47943897](https://news.ycombinator.com/item?id=47943897) by shad42, 2026-04-29 |
| 上下文成本 | 上下文规模、费用和注意力效果 | [48814267](https://news.ycombinator.com/item?id=48814267) by wolvoleo, 2026-07-07；[47943897](https://news.ycombinator.com/item?id=47943897) by shad42, 2026-04-29 |
| 量化质量 | 显存节省和质量退化 | [47976425](https://news.ycombinator.com/item?id=47976425) by rhdunn, 2026-05-01；[48787998](https://news.ycombinator.com/item?id=48787998) by hmry, 2026-07-04 |
| 推理运维 | 缓存、显存和依赖环境 | [49001956](https://news.ycombinator.com/item?id=49001956) by verdverm, 2026-07-22；[41719333](https://news.ycombinator.com/item?id=41719333) by reissbaker, 2024-10-02 |
| ROCm 适配摩擦 | 驱动、构建和硬件适配 | [49035356](https://news.ycombinator.com/item?id=49035356) by stevefan1999, 2026-07-24 |
| MCP 配置 | 工具协议、配置和权限 | [48837119](https://news.ycombinator.com/item?id=48837119) by twosdai, 2026-07-08；[48383439](https://news.ycombinator.com/item?id=48383439) by gauravvij137, 2026-06-03 |
| 供应商路由 | 聚合平台和参数差异 | [49646455](https://news.ycombinator.com/item?id=49646455) by coder543, 2026-09-10；[49493800](https://news.ycombinator.com/item?id=49493800) by Bolwin, 2026-08-29 |
| 企业模型目录 | 区域、合规和采购流程 | [48738233](https://news.ycombinator.com/item?id=48738233) by 0xbadcafebee, 2026-06-30；[49482691](https://news.ycombinator.com/item?id=49482691) by daemonologist, 2026-08-28 |
| 榜单质疑 | 评测饱和、污染和真实工作负载 | [49178215](https://news.ycombinator.com/item?id=49178215) by 827a, 2026-08-05；[49452469](https://news.ycombinator.com/item?id=49452469) by respectattentio, 2026-08-26；[46320345](https://news.ycombinator.com/item?id=46320345) by grog454, 2025-12-18 |
| Vibe coding 与 AI slop | 生成速度、审查和低质量堆积 | [49665453](https://news.ycombinator.com/item?id=49665453) by keeda, 2026-09-11；[49666403](https://news.ycombinator.com/item?id=49666403) by sosodev, 2026-09-11；[49665135](https://news.ycombinator.com/item?id=49665135) by gib444, 2026-09-11 |
| GPU 贫穷 | 本地能力和显存预算 | [47203886](https://news.ycombinator.com/item?id=47203886) by lubitelpospat, 2026-03-01；[48152126](https://news.ycombinator.com/item?id=48152126) by fgfarben, 2026-05-15 |
| Agent 失忆 | 会话重置和持久记忆 | [49026466](https://news.ycombinator.com/item?id=49026466) by 3s, 2026-07-23；[49581249](https://news.ycombinator.com/item?id=49581249) by okf_memory, 2026-09-05 |
| 模型下载与运行 | 模型仓库、依赖和硬件兼容 | [48416486](https://news.ycombinator.com/item?id=48416486) by simonw, 2026-06-05；[46729872](https://news.ycombinator.com/item?id=46729872) by parentheses, 2026-01-23 |
| 本地硬件预填充 | 本地推理速度和硬件差异 | [49607008](https://news.ycombinator.com/item?id=49607008) by EagnaIonat, 2026-09-08；[45214843](https://news.ycombinator.com/item?id=45214843) by evilduck, 2025-09-11 |

## 四、公开游戏产品与行业实践资料

以下资料用于研究科技树、里程碑、卡牌平衡、运营和玩家验证方法，不直接构成 Model Mayhem
的现实模型或组织事实。

| 来源方 | 页面 | 项目用途 |
|---|---|---|
| Blizzard Entertainment | [Hearthstone 36.4.2](https://hearthstone.blizzard.com/en-gb/news/24296231/3642-patch-notes)、[Hearthstone 34.6](https://hearthstone.blizzard.com/en-us/news/24242740/346-patch-notes)、[Diablo III Auction House Update](https://news.blizzard.com/en-gb/article/10974978/diablo-iii-auction-house-update) | 卡牌平衡、补丁和交易系统风险 |
| Wizards of the Coast | [Standard Format](https://magic.wizards.com/en/formats/standard)、[Play Design Lessons](https://magic.wizards.com/en/news/feature/play-design-lessons-learned-2019-11-18)、[Banned and Restricted August 2026](https://magic.wizards.com/en/news/announcements/banned-and-restricted-august-10-2026) | 轮换、禁用和长期平衡 |
| Riot Games | [Teamfight Tactics Learnings](https://teamfighttactics.leagueoflegends.com/en-gb/news/dev/dev-teamfight-tactics-reckoning-learnings/)、[TFT 18.2](https://teamfighttactics.leagueoflegends.com/en-us/news/game-updates/teamfight-tactics-patch-18-2/)、[2XKO Balance](https://2xko.riotgames.com/en-gb/news/dev/2xko-live-balance-philosophy/)、[2XKO Development Update](https://www.riotgames.com/en/news/2xko-active-development-ends-december-2026)、[League Balance Framework](https://www.leagueoflegends.com/en-gb/news/dev/dev-balance-framework-update/)、[Runeterra FAQ](https://playruneterra.com/en-us/news/game-updates/legends-of-runeterra-2024-state-of-the-game-faq)、[Matchmaking](https://support.riotgames.com/league-of-legends/gameplay/matchmaking-and-autofill) | 平衡分层、匹配和长期运营 |
| Second Dinner | [Marvel Snap Balance Notes](https://www.marvelsnap.com/november-9th-balance-updates/)、[September 2026 Update](https://www.marvelsnap.com/balance-update-september-10-2026/) | 高频平衡和 OTA 调整 |
| Firaxis Games | [Ages](https://civilization.2k.com/en-GB/civ-vii/game-guide/dev-diary/ages/)、[April 2025 Update](https://civilization.2k.com/civ-vii/news/civ-vii-update-check-in-apr-8/) | 时代推进和里程碑 |
| Gaijin Entertainment | [Progression and Economy](https://warthunder.com/en/news/8260/current)、[Economy Revision](https://warthunder.com/en/news/8318-development-economy-revision-our-plan-in-detail-en) | 科技树、经济和玩家负担 |
| Grinding Gear Games | [Passive Skill Tree](https://www.pathofexile.com/passive-skill-tree) | 大型节点图和路线选择 |
| CCP Games | [EVE Monthly Economic Report](https://www.eveonline.com/news/view/monthly-economic-report-august-2026) | 虚拟经济和公开数据 |
| Valve | [Steam Playtest](https://partner.steamgames.com/doc/features/playtest)、[Valve Playtesting](https://cdn.fastly.steamstatic.com/apps/valve/2009/GDC2009_ValvesApproachToPlaytesting.pdf)、[Slay the Spire 2](https://store.steampowered.com/app/2868840/Slay_the_spire_2/) | Playtest、平台和品类研究 |
| 游戏可访问性资料 | [Game Accessibility Guidelines](https://gameaccessibilityguidelines.com/full-list/)、[Xbox Accessibility Guidelines](https://learn.microsoft.com/en-us/xbox/accessibility/guidelines)、[Apple Review Guidelines](https://developer.apple.com/app-store/review/guidelines/) | 可访问性和发布约束 |
| 教育机构与会议 | [MIT CMS.301](https://ocw.mit.edu/courses/cms-301-introduction-to-game-design-methods-spring-2016/)、[MIT CMS.608](https://www.ocw.mit.edu/courses/cms-608-game-design-spring-2014/)、[MIT CMS.611J](https://ocw.mit.edu/courses/cms-611j-creating-video-games-fall-2014/)、[NYU Game Center](https://gamecenter.nyu.edu/academics/)、[USC Games](https://games.usc.edu/)、[GDC Vault](https://gdcvault.com/)、[Game Studies](https://gamestudies.org/)、[CHI PLAY](https://chiplay.acm.org/)、[FDG 2026](https://fdg2026.org/call-for-papers/) | 设计方法、培训和验证研究 |
| AI 工具与 Skill 生态 | [Agent Skills](https://agentskills.io/specification)、[OpenAI Skills](https://developers.openai.com/codex/skills)、[OpenAI Plugins](https://github.com/openai/plugins)、[Anthropic Skills](https://github.com/anthropics/skills)、[Agent Skills Overview](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview)、[OpenCode](https://opencode.ai/docs/skills/)、[Cursor](https://prod.cursor.com/docs/skills) | Agent 能力封装和验证体系 |

这些页面受各自网站条款、出版方条款或仓库许可证约束。项目没有复制课程材料、GDC 视频、
游戏界面、官方图片或仓库代码。

## 五、视觉与媒体素材

本次审计未发现项目自有或随项目分发的外部位图、照片、插画、音频、视频、字体或标志素材。

界面图标来自代码依赖 `lucide-react`，属于第三方软件依赖，不在本文件展开。项目没有把
Lucide 图标作为社区内容鸣谢对象，也没有把任何公司标志用作卡面素材。

## 六、其他来源与权利边界

### 6.1 项目内部设计资料

以下内部文档被部分通用内容卡标为 `sources`：

- `docs/design/06-world-events-knowledge.md`
- `docs/design/08-modes-content-mvp.md`
- `docs/design/16-number-system.md`

它们是项目设计依据，不是外部内容来源。其中 13 张标记为 `archive` 的卡只有内部来源，
尚不满足“archive 至少需要一条一手外部来源”的内容规则，详见审计报告。

### 6.2 公司、模型与产品名称

名称和商标归各自权利人。项目使用名称是为了描述现实对象、历史关系或公开产品，
不表示背书的含义。未使用其标志，也不声称获得任何官方许可。

### 6.3 直接引用边界

本次审计没有发现复制到仓库中的论文正文、论文图表、新闻全文、社区评论正文、宣传图片、
音频或视频。该结论来自文件、URL 和媒体类型检查，不构成法律意见，也不等于完成了语义相似度
或版权侵权鉴定。

## 七、待核实项

1. 7 个 OpenAI 深链自动请求返回 403，需要人工浏览器复核页面仍可用。
2. 根级研究文档的 DOI、出版社页面和部分游戏官网自动请求受限，需要逐条人工复核。
3. 13 张 `archive` 卡只有内部设计文档来源，需要补一手来源或降级为合适的社区或虚构分类。
4. 同一组 Hacker News 讨论只能支持“社区观察”，不能证明广泛行业共识。
5. 商业发布前需要单独完成商标、页面条款、论文许可和社区内容使用边界复核。
