# Issue AI Agent

GitHub Issue AI Bot — 自动分类、回复、复现、修复。

## 快速链接

- [设计文档](./DESIGN.md) — 完整调研报告与技术方案

## 项目结构（待创建）

```
issue-ai-agent/
├── CLAUDE.md          ← 本文件
├── DESIGN.md          ← 设计文档（调研+技术方案）
├── src/               ← 源代码（Phase 1 开始时创建）
└── .github/           ← GitHub App 配置
```

## 技术栈

- **运行时**：Node.js (TypeScript)
- **框架**：Probot (GitHub App)
- **LLM**：用户自带 API Key (BYOK) — Claude / OpenAI / Ollama
- **沙箱**：E2B / Docker
- **修复引擎**：mini-swe-agent（Phase 3 集成）

## 开发阶段

- [ ] Phase 1：Issue 分类 + 自动回复 (MVP)
- [ ] Phase 2：Bug 沙箱复现
- [ ] Phase 3：集成 mini-swe-agent 修复 PR
- [ ] Phase 4：优化推广
