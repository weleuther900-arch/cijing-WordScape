# Offline voice notices

This optional, on-device English voice uses the following components:

- HeadTTS 1.3.0 — MIT License. Its included `LICENSE` file is in `headtts/LICENSE`.
- CMU Pronouncing Dictionary 0.7 — simplified BSD license. The source notice remains at the top of `headtts/dictionaries/en-us.txt`.
- Transformers.js 4.0.0 — Apache-2.0 License, fetched from its pinned public release only while preparing the voice.
- ONNX Runtime Web — MIT License, used by Transformers.js.
- Kokoro-82M ONNX timestamped model and the `af_bella` voice — Apache-2.0 License, fetched from the fixed public model revision only when the user chooses to prepare the voice.

The model and voice are not included in this repository. They are fetched only when the user chooses to prepare the optional voice, then retained in browser-managed private storage. The word being read and generated audio are never uploaded.