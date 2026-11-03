# 参与贡献

欢迎提交可复现的问题、文档修正和范围明确的改进。开始前先读 [README](README.md) 与 [协作规则](AGENTS.md)。

## 报告问题

在 Issues 说明操作系统、Node.js版本、执行命令、预期结果和实际结果，尽量提供不含私人素材的最小复现。日志先去掉API Key、令牌、密码、Cookie和个人资料。

安全漏洞通过 [私密安全报告](https://github.com/imocone/historical-explainer-video/security/advisories/new) 提交，处理方式见 [安全说明](SECURITY.md)。

## 修改与验证

保持一个PR解决一个问题，说明改了什么、原因和实际验证。制作逻辑、正式合同或责任包的修改遵守现行协作规则，保留已有有效能力。

已有检查入口：

```bash
# 核对当前项目清单、资源和合同
node engine/cli.mjs check
# 路径、配置和授权边界等本地安全测试
npm run test:safety
# 修改压片资源选择或收尾清理时
node --test packages/modules/render-video/runtime/hyperframes.test.mjs packages/modules/render-video/runtime/cleanup.test.mjs
```

只运行与本次改动相关的检查；纯文档修改核对文本和链接即可。测试使用临时目录和模拟服务，验证普通修改不调用真实付费生成或平台发布。

## 素材与凭据

只提交源码、必要图例和有明确分发许可的资源，保留第三方来源与许可。成品视频、个人配置、登录状态、真实节目及不能公开的原素材留在本机。不要使用强制添加绕过忽略规则。
