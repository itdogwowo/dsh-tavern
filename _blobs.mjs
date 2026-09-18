/**
 * 檢查 repo 裡每個檔案的 git blob（LF 正規化後）SHA-1，用來跟 GitHub API 比對。
 * 用法：node _blobs.mjs
 */
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = process.cwd()
function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === '.git' || entry === 'node_modules') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}
const sha = (buf) =>
  createHash('sha1')
    .update(Buffer.concat([Buffer.from(`blob ${buf.length}\0`, 'utf8'), buf]))
    .digest('hex')

for (const file of walk(root).sort()) {
  const lf = Buffer.from(readFileSync(file, 'utf8').split('\r\n').join('\n'), 'utf8')
  console.log(`${sha(lf).slice(0, 12)}  ${relative(root, file)}`)
}
