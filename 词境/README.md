# 词境本地运行说明

首次运行 `创建桌面图标.ps1` 后，桌面会出现“词境”图标。之后双击图标即可自动启动本地网站并打开浏览器，无需复制网址。

也可以在本文件夹中执行：

```powershell
.\start.cmd
```

它会自动安装依赖、建立 MIT 许可的 ECDICT 离线词典索引，并启动 <http://127.0.0.1:4173>。

也可手动执行：

```powershell
npm.cmd install
npm.cmd run dictionary:install
npm.cmd start
```

## 本地文件

- `data/state.json`：单词本、学习进度与复习记录。
- `data/offline-dictionary.json`：离线英汉词典索引。

以上文件均不会进入 Git；原始导入文件也不会被保存。

Excel 支持 `.xlsx` 与 `.xlsm`；旧版 `.xls` 请先另存为 `.xlsx`。
