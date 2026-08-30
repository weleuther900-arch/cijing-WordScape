# WordScape 免费三端同步

这个 Worker 与现有静态网站一起部署：`/api/sync` 写入 Cloudflare D1，其他请求继续返回 `ios-web` 中的网站文件。

同步密钥不会发给 Worker；浏览器以密钥导出 AES-256-GCM 密钥，将学习数据加密后再上传。D1 仅保存密文、同步标识的 SHA-256 哈希和版本号。静态网页仍直接由 Cloudflare 就近返回，只有 `/api/sync` 会进入 Worker。

## 首次部署

在 `词境` 文件夹打开 PowerShell，按顺序执行：

```powershell
npm.cmd run ios:web:prepare
npx wrangler@latest login
npx wrangler@latest d1 create wordscape-sync
```

第三条命令会显示一段 D1 配置标识。将它只保存到本机的 `cloudflare/wrangler.toml`；该文件已经被 GitHub 忽略，不会随项目同步。

完成本机配置后继续：

```powershell
cd cloudflare
npx wrangler@latest d1 execute wordscape-sync --remote --file=./schema.sql
npx wrangler@latest deploy
```

成功后访问原网址 `https://wordscape.weleuther900.workers.dev`。电脑、iPhone、iPad 都进入“设置 → 云端自动同步”，输入完全相同的同步密钥。

## 验证

1. 在电脑的“设置”启用同步，点“立即同步”。
2. 在 iPhone / iPad 输入同一同步密钥，点“立即同步”。
3. 在任一设备学习或复习一个词，等待约两秒，换到另一设备重新打开页面或点“立即同步”。
4. 两端都应保留该词的学习状态与复习日志。

如果不再想让某台设备同步，选择“停止这台设备的同步”；不会删除这台设备或云端的既有记录。
