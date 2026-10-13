/**
 * Single place to update release availability.
 * When a public GitHub Release really contains `installerAsset`,
 * set `released: true` (and fill `version` only from that release).
 */
export const site = {
  repo: 'https://github.com/sadeghimohammadamin83-ship-it/mindspace',
  releasesUrl: 'https://github.com/sadeghimohammadamin83-ship-it/mindspace/releases',
  issuesUrl: 'https://github.com/sadeghimohammadamin83-ship-it/mindspace/issues',
  installerAsset: 'MINDSPACE-Setup.exe',
  released: false,
  version: '' // e.g. '0.1.0' — only once published
}

export const downloadUrl = `${site.repo}/releases/latest/download/${site.installerAsset}`
