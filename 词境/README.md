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

## 在 iPhone 和 iPad 上独立使用

词境现在是离线优先的 iOS Web App。先在电脑生成一次完整的静态发布包：

```powershell
npm.cmd run ios:web:prepare
```

将生成的 `ios-web` 文件夹部署到任意 HTTPS 静态网站后，首次用 iPhone 或 iPad 的 Safari 打开，选择“分享”→“添加到主屏幕”。安装完成后，词境会以独立应用窗口运行，学习进度、单词本、设置和离线词典都保存在这台 iPhone/iPad 本机；不需要电脑、局域网或持续联网。发布包会将离线词典压缩为约 15 MB，适合直接上传到静态网站。

- 启用 Cloudflare D1 同步后，电脑、iPhone 和 iPad 可输入同一条同步密钥，自动合并词本、学习进度、复习记录和独立记忆表；详情见 [cloudflare/README.md](cloudflare/README.md)。同步密钥不会上传，云端只保存浏览器加密后的数据。
- 重要：iOS 会将浏览器与“添加到主屏幕”后的应用本机数据分开保存。首次添加前，请先在浏览器“设置 → 云端自动同步”中启用同步并点“立即同步”；主屏幕版首次打开、空白学习页和设置页都会提供“恢复已有词本”，粘贴同一密钥即可恢复词本。也可使用数据备份文件恢复。若启动页意外卡住，打开 `refresh.html` 可仅移除旧界面缓存，不会删除词本。
- iPhone/iPad 的英语声音默认跟随本机当前系统声音，不会被电脑或云端的声音选择覆盖；如手动选择某个声音，该选择也只保留在这台设备。
- iOS 离线版支持手动粘贴单词和导入 TXT；PDF、Word、Excel 的提取仍需使用电脑本地版。
- 词境会自动保存本机记录；请定期在“设置”→“数据备份”导出备份到“文件”或 iCloud Drive。即使换机或误清除网站数据，也可从备份恢复。
- 这是一种无需 App Store 的 iOS 独立 Web App。若要发布为 App Store 原生 App（IPA），仍需在 macOS 上用 Xcode 打包和签名。

## 本地文件

- `data/state.json`：单词本、学习进度、复习记录与独立记忆表。
- `data/offline-dictionary.json`：离线英汉词典索引。

以上文件均不会进入 Git；原始导入文件也不会被保存。

Excel 支持 `.xlsx` 与 `.xlsm`；旧版 `.xls` 请先另存为 `.xlsx`。
