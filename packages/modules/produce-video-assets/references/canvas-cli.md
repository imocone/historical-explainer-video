# 即梦画布 CLI 使用与升级

`generate.mjs`通过包内`canvas.mjs`调用`dreamina-canvas`，再由原剪接程序形成正式交付。具体协议以安装版本的`schema`和实时模型目录为准；协议细节按官方Skill的路由读取：`~/.agents/skills/dreamina-canvas-cli/SKILL.md`。

## 安装与升级

macOS／Linux安装和升级使用同一官方入口，同时更新二进制和官方Skill：

```bash
curl -fsSL https://jimeng.jianying.com/canvas-cli/install.sh | bash
dreamina-canvas --format json version
dreamina-canvas --format json schema
```

macOS默认二进制在`~/.local/bin/dreamina-canvas`，Skill在`~/.agents/skills/dreamina-canvas-cli/`。维护时运行安装器；生产过程中不自动升级，不因版本变化重新生成已完成素材。升级后先核对本模块使用的命令及实时模型规格，重新加载官方Skill。

## 登录

先执行`dreamina-canvas --format json auth status`。未登录时执行`auth login`，在系统默认浏览器打开返回的verificationUriComplete并发给用户，由用户登录授权；链接已带码时不重复要求输码。用原deviceCode执行`auth wait --device-code <原设备引用>`，再核对`auth status`和`auth account`。不读取或导出凭据，不因等待未完成再次login或force。

## 供应商调用

以下动作由程序在原分次记录内连续执行：

1. 保存projectId，创建或恢复本集画布，返回webUrl供用户查看。
2. 查询CLI版本，以`model find <现行模型名> --type video`取得规范模型名。首组上传唯一首图并使用`first_last_frame`；后组默认以`m2v`直接引用前组成功的原生成节点，仅明确的剪后参考例外上传前组剪片。`--ref node:<实际参考节点>`建立依赖，提示中的`@Video 1`转换为该节点的正文引用。
3. 以`node quote`取得完整报价。在当前首次付费或具体替换授权内，用该报价作为积分上限取得`node confirm`凭证，再以预先保存的submitId执行一次`node run`；凭证只留内存。
4. 以`operation status <原submitId> --project-id <原画布>`查询原操作。成功后用`resource get`取得视频资源事实，`resource download --output <原下载路径>`下载MP4，交原FFmpeg链剪定。

## 故障处理

使用JSON的error.code、class、requiredAction及requestId判断，原报错保存在原分次记录，不压缩成只有“failed”。只读请求的可重试传输失败有界重试；写入响应未知保留原身份。付费运行一旦开始，只查询原操作，absent不证明没有扣费，不自动重放。

上传与节点保存使用各自原resourceId、nodeId、updateId和导入submitId恢复；未开始付费运行的准备工作可以沿同一记录继续。已完成文件及原记录保持，不为CLI升级补写新身份。旧CLI未收口对象不能冒充画布对象，须保留其原编号和证据核实，不通过新CLI重新创建来替代恢复。

CLI版本或协议不符时沿官方安装入口升级，登录问题沿原授权处理。平台明确失败、价格超过本次上限、未知提交的替换和前组变化后的已付费续接仍服从模块原付费边界，不用`--yes`批准任意花费。
