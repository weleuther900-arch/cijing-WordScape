# 第三方开源声明

词境只依赖可再分发的开源软件与数据。下列内容均按各自许可证使用；其许可证文本与上游仓库可在对应链接中查阅。

| 名称 | 用途 | 许可证 | 上游 |
| --- | --- | --- | --- |
| [ECDICT](https://github.com/skywind3000/ECDICT) | 离线英汉词典数据 | MIT | skywind3000/ECDICT |
| [fflate](https://github.com/101arrowz/fflate) | `.xlsx` / `.xlsm` 文件解压与读取 | MIT | 101arrowz/fflate |
| [Mammoth](https://github.com/mwilliamson/mammoth.js) | `.docx` 文本提取 | BSD-2-Clause | mwilliamson/mammoth.js |
| [PDF.js](https://github.com/mozilla/pdf.js) | PDF 文本提取 | Apache-2.0 | mozilla/pdf.js |
| [HeadTTS](https://github.com/met4citizen/HeadTTS) | 可选统一离线英语声音的浏览器流程与英语发音规则 | MIT | met4citizen/HeadTTS |
| [Transformers.js](https://github.com/huggingface/transformers.js) | 可选统一离线英语声音的浏览器推理运行时 | Apache-2.0 | huggingface/transformers.js |
| [Kokoro-82M ONNX](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX-timestamped) | 可选 `af_bella` 统一英语声音模型 | Apache-2.0 | onnx-community/Kokoro-82M-v1.0-ONNX-timestamped |
| [CMU Pronouncing Dictionary](http://www.speech.cs.cmu.edu/cgi-bin/cmudict) | 美式英语发音词典 | 简化 BSD | Carnegie Mellon University |
| [Node.js](https://github.com/nodejs/node) | 本地运行时 | MIT | nodejs/node |

ECDICT 的本地索引由 `词境/scripts/install-offline-dictionary.js` 根据固定提交生成，存放在 `词境/data/`，不进入本仓库。项目不包含或再分发牛津、剑桥等商业词典内容。

统一离线英语声音的量化 Kokoro 模型与 `af_bella` 声音不随仓库发布；仅在用户于设置中主动准备时从固定公开版本取得，并保存到当前浏览器的私有设备空间。朗读的单词内容不会上传。
