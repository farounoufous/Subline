export function computeFingerprint(file) {
  return `${file.name}::${file.size}::${file.lastModified}`
}
