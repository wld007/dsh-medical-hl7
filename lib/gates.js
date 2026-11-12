/**
 * 残留标识符检查：交付前把每个字符串（含 base64 正文解码后）扫一遍，
 * 找像真实身份证号（校验位正确）、手机号的内容。命中只记遮盖后的值，不记原文。
 */
const ID18 = /(?<![0-9A-Za-z])([1-9]\d{5}(?:18|19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx])(?![0-9A-Za-z])/g
const MOBILE = /(?<![0-9A-Za-z])(1[3-9]\d{9})(?![0-9A-Za-z])/g
const W = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
const C = '10X98765432'

export function validIdCard(s) {
  let sum = 0
  for (let i = 0; i < 17; i++) sum += Number(s[i]) * W[i]
  return C[sum % 11] === s[17].toUpperCase()
}
const mask = (s) => `${s.slice(0, 2)}${'*'.repeat(Math.max(0, s.length - 4))}${s.slice(-2)}`

export function scanResidual(resources, limit = 50) {
  const hits = []
  const check = (text, where) => {
    if (typeof text !== 'string' || text.length < 11) return
    for (const m of text.matchAll(ID18)) if (validIdCard(m[1])) hits.push({ kind: '身份证号', value: mask(m[1]), where })
    for (const m of text.matchAll(MOBILE)) hits.push({ kind: '手机号', value: mask(m[1]), where })
  }
  const visit = (node, r, path) => {
    if (hits.length >= limit) return
    if (Array.isArray(node)) { node.forEach((x, i) => visit(x, r, `${path}[${i}]`)); return }
    if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) {
        if (k === 'data' && typeof v === 'string') check(Buffer.from(v, 'base64').toString('utf8'), `${r.resourceType}/${r.id} ${path}.${k}`)
        else if (typeof v === 'string') check(v, `${r.resourceType}/${r.id} ${path}.${k}`)
        else visit(v, r, `${path}.${k}`)
      }
    }
  }
  for (const r of resources) { if (hits.length >= limit) break; visit(r, r, r.resourceType) }
  return hits
}
