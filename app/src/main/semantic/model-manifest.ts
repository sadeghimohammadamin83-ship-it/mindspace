/**
 * The one embedding model MINDSPACE ships support for in Phase 5.
 *
 * intfloat/multilingual-e5-small (MIT licence, ~100 languages incl. Persian,
 * 384 dimensions, 512 tokens), in the ONNX export published by Xenova on
 * Hugging Face (int8 quantised weights). Pinned to one repository revision
 * and verified by SHA-256, so the stored vectors always come from exactly
 * these weights. Changing anything here changes `modelId`, which makes the
 * indexer re-embed every source.
 */
export const E5_MODEL = {
  displayName: 'multilingual-e5-small (int8, ONNX)',
  license: 'MIT',
  repo: 'Xenova/multilingual-e5-small',
  revision: '761b726dd34fb83930e26aab4e9ac3899aa1fa78',
  dimensions: 384,
  maxTokens: 512,
  onnxFile: 'onnx/model_quantized.onnx',
  tokenizerFile: 'tokenizer.json',
  tokenizerConfigFile: 'tokenizer_config.json',
  files: [
    { path: 'config.json', size: 658, sha256: 'cb99455288675345e1a4f411438d5d0adbba5fbd3a67ea4fb03c015433b996c1' },
    { path: 'tokenizer.json', size: 17_082_730, sha256: '0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39' },
    { path: 'tokenizer_config.json', size: 443, sha256: 'a1d6bc8734a6f635dc158508bef000f8e2e5a759c7d92f984b2c86e5ff53425b' },
    { path: 'onnx/model_quantized.onnx', size: 118_308_185, sha256: 'f80102d3f2a1229f387d3c81909990d8945513e347b0eab049f7de3c6f98c193' }
  ],
  get modelId(): string {
    return `multilingual-e5-small@${this.revision.slice(0, 12)}/q8/v1`
  }
} as const

export const modelDownloadUrl = (path: string) =>
  `https://huggingface.co/${E5_MODEL.repo}/resolve/${E5_MODEL.revision}/${path}`
