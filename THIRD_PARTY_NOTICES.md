# 第三方开源声明

词境只依赖可再分发的开源软件与数据。下列内容均按各自许可证使用；其许可证文本与上游仓库可在对应链接中查阅。

| 名称 | 用途 | 许可证 | 上游 |
| --- | --- | --- | --- |
| [ECDICT](https://github.com/skywind3000/ECDICT) | 离线英汉词典数据 | MIT | skywind3000/ECDICT |
| [fflate](https://github.com/101arrowz/fflate) | `.xlsx` / `.xlsm` 文件解压与读取 | MIT | 101arrowz/fflate |
| [Mammoth](https://github.com/mwilliamson/mammoth.js) | `.docx` 文本提取 | BSD-2-Clause | mwilliamson/mammoth.js |
| [PDF.js](https://github.com/mozilla/pdf.js) | PDF 文本提取 | Apache-2.0 | mozilla/pdf.js |
| [Node.js](https://github.com/nodejs/node) | 本地运行时 | MIT | nodejs/node |

ECDICT 的本地索引由 `词境/scripts/install-offline-dictionary.js` 根据固定提交生成，存放在 `词境/data/`，不进入本仓库。项目不包含或再分发牛津、剑桥等商业词典内容。
