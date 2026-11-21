# dsh-ponytail-official

[DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail) 官方正文的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件。

技能正文与 always-on 规则**逐字同步自上游 tag**，不做任何改写或裁剪。当前对齐：**v5.3.3**

## 它做什么

- **always-on 规则注入**：官方 `AGENTS.md` 原文，经 `systemPrompt.section`（order 50）进入每个会话
- **6 个 skill**：`/ponytail`、`/ponytail-review`、`/ponytail-audit`、`/ponytail-debt`、`/ponytail-gain`、`/ponytail-help`
- 零 tool 注册、零配置面、零落盘状态——卸载即彻底消失，不留任何文件

## 安装

```powershell
# 1. 克隆到本地插件目录（路径随意，示例用 D:\dsh-plugins）
git clone https://github.com/Zgt00086/dsh-ponytail-official.git D:\dsh-plugins\dsh-ponytail-official

# 2. 在 profile 的 package.json 里挂两处（C:\Users\<你>\.dsh\profiles\<profile>\package.json）
#    dependencies 加:        "dsh-ponytail-official": "link:D:/dsh-plugins/dsh-ponytail-official"
#    dsh.profile.bundles 加:  "dsh-ponytail-official"

# 3. 建链接（开发者模式或管理员 PowerShell）
New-Item -ItemType SymbolicLink `
  -Path "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-ponytail-official" `
  -Target "D:\dsh-plugins\dsh-ponytail-official"

# 4. 重启 DSH
```

生效判据：DSH 日志出现 `[ponytail-official] 已激活`，会话输入 `/` 能看到 6 个 ponytail 技能。

`yaml` 依赖已 vendor 在 `node_modules/yaml`，克隆后无需 `npm install` 即可运行。

## 接收上游更新通知

**每次 DSH 启动时自动检查一次**：插件加载时异步请求
`https://github.com/DietrichGebert/ponytail/releases/latest`，跟随 302 拿到最新 tag，
超过 6 秒或网络不可达就静默跳过（不阻塞启动、不报错）。
检测到落后时做两件事：

- `ctx.logger.warn` 打印：`上游有新版本：vX.Y.Z（当前 vA.B.C）`
- 在 system prompt 里追加一行提示，模型会在回复里顺带告诉你

上游发新版时怎么第一时间知道，三条云端通道可以叠加用：

| 方式 | 通知落点 | 时效 | 配置 |
|---|---|---|---|
| 本仓库 GitHub Actions 每周五检查 | GitHub issue → 手机 app 推送 | 每周五 20:00（北京时间） | 已内置，无需配置 |
| Watch 本仓库（Custom → Issues） | 手机 app 推送 | 新 issue 即时 | 仓库页 Watch → Custom |
| Watch 上游 + Releases only | 手机 app 推送 | 上游发版即时 | 上游页 Watch → Custom → Releases |
| RSS | RSS 阅读器 | 即时 | 订阅 releases.atom |

`upstream-watch` 工作流每周五跑一次：拉上游 tag 列表、跟 `package.json` 版本比对，
落后就自动开一个 issue，正文里带版本对照、Release 链接和完整更新命令。
想立刻测一次：仓库页 Actions → upstream-watch → Run workflow → 勾 `simulate_behind`。

上游 Releases RSS：`https://github.com/DietrichGebert/ponytail/releases.atom`

## 更新（跟官方新版本）

```powershell
# 先更新上游真源
git -C D:\ponytail-upstream fetch --tags --force

# 再同步进插件（默认跟最新 tag，也可 -Tag v5.4.0 指定）
powershell -NoProfile -ExecutionPolicy Bypass -File D:\dsh-plugins\dsh-ponytail-official\update-from-upstream.ps1
```

脚本从上游 clone 读取 `skills/` 与 `AGENTS.md`，覆盖进插件并对齐 `package.json` 版本号。
上游路径默认取插件同级目录的 `ponytail-upstream`，找不到再找 `D:\ponytail-upstream`，也可用 `-Upstream <path>` 指定。

## 卸载

```powershell
Remove-Item "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-ponytail-official" -Force
# 再从 package.json 删掉 dependencies 与 bundles 两处条目，重启 DSH
```

## 与 @wenaixi/dsh-ponytail 的关系

两者互为替代，不要同时装（技能同名冲突）。本插件只做官方正文的搬运，
不提供档位切换、配置面板与零缓存破坏——那些是 wenaixi 版自己的工程。

## 结构

```
lib/index.js              插件入口：注册 SkillProvider + 注入 AGENTS.md
skills/                   6 个 SKILL.md（上游原文）
AGENTS.md                 上游规则原文
cordis.patch.yml          bundle 挂载声明
update-from-upstream.ps1  上游同步脚本
node_modules/yaml         vendored 依赖（自包含）
```

## License

MIT，见 [LICENSE](LICENSE)。`skills/`、`AGENTS.md` 内容版权归 Dietrich Gebert，随上游 MIT 许可分发。
