<div align="center">

# 词境 · WordScape

### 在语境中认识单词，在间隔中把它留住。

_A local-first, fully open-source English learning space._

`离线词典` · `语境学习` · `间隔复习` · `本地数据`

</div>

> “What we learn with pleasure, we never forget.”
> 愉悦中学到的东西，永远不会忘记。

## 这是什么

词境是一个运行在自己电脑上的英语学习工具：导入单词后，在语境中学习；再通过新的中文情景、英文挖空和 FSRS 间隔复习巩固记忆。它没有账号、云同步或远程数据库。

学习记录始终只保存在本机。内置离线词典后，即使断网也能显示中文释义、词性与音标。

## 功能

| 模块 | 内容 |
| --- | --- |
| 离线英汉词典 | 首次启动安装 MIT 许可的 ECDICT 本地索引；导入词与已有空释义词会自动补齐。 |
| 词表与词本 | 多个本地单词本；错词库统计错误次数；优先展示错词、已保存词和已掌握词的统一搜索。 |
| 初次学习 | 每页学习、侧栏进度、按需显示中文句意；点击单词或句意时朗读英文。 |
| 间隔复习 | 中文新情景 + 英文挖空 + 延迟候选；正确/错误清晰区分，支持上一题与 FSRS 排程。 |
| 本地导入 | 粘贴文本，或导入 TXT、PDF、Word、Excel（`.xlsx` / `.xlsm`）；仅提取英文词。 |

## 在自己的电脑上部署

需要：开源的 [Node.js 20+](https://nodejs.org/)，以及支持 Web Speech 的现代浏览器。Git 仅在使用命令克隆时需要；下载 GitHub 的 ZIP 后也可以直接运行。

### 1. 获取项目

使用 Git：

```powershell
git clone <你的 GitHub 仓库地址>
```

或者在 GitHub 页面点击 **Code → Download ZIP**，解压后继续下一步。

### 2. 首次启动

```powershell
cd .\词境
.\start.cmd
```

首次运行会自动完成三件事：安装开源依赖、下载固定版本的 ECDICT 数据、在本地生成离线词典索引。完成后会自动打开词境。

### 3. 创建桌面图标（推荐）

在 `词境` 文件夹中执行一次：

```powershell
.\创建桌面图标.ps1
```

桌面会生成名为“词境”的图标。以后直接双击它就会在后台启动本地服务并打开网站，无需手动输入网址。若 PowerShell 询问是否运行脚本，选择允许当前脚本运行即可。

如果希望手动执行：

```powershell
npm.cmd install
npm.cmd run dictionary:install
npm.cmd start
```

旧版 `.xls` 是已淘汰的二进制格式；请在 Excel 中将它另存为 `.xlsx` 再导入。`.xlsx` 与 `.xlsm` 可直接读取。

## 数据、网络与隐私

- 学习记录：`词境/data/state.json`
- 离线词典：`词境/data/offline-dictionary.json`
- 两者都被 `.gitignore` 排除，不会提交或上传到 GitHub。
- 服务只监听 `127.0.0.1`，不会暴露到局域网或公网。
- 导入的原始文件仅在内存中读取，不会被保存。

## 开源与数据来源

本项目使用 [MIT License](LICENSE) 发布。运行时依赖和离线词库均采用可再分发的开源许可证；完整清单见 [第三方声明](THIRD_PARTY_NOTICES.md)。

离线英汉词典数据来自 [ECDICT](https://github.com/skywind3000/ECDICT)，按其 MIT 许可证使用，并固定到可复现的源版本。项目不打包或抓取牛津、剑桥等商业词典内容。

## 项目结构

```text
.
├─ 词境/
│  ├─ public/              # 前端页面、样式与本地内容
│  ├─ scripts/             # 开源离线词典安装器
│  ├─ data/                # 仅本地：学习状态与词典索引（不进 Git）
│  ├─ server.js            # 只监听本机的 Node 服务
│  └─ start.cmd            # Windows 一键启动
├─ LICENSE
└─ THIRD_PARTY_NOTICES.md
```

为安静、持续、真正属于自己的学习而做。
