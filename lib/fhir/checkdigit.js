/**
 * 标准代码的校验位：模型给出的代码先过这一关，编造的代码多半通不过。
 *   LOINC：NNNNN-C，C 为 mod 10（Luhn）校验位
 *   SNOMED CT：6–18 位数字，末位 Verhoeff 校验；倒数 2–3 位是分区号（概念为 00 或 10）
 */
export function loincValid(code) {
  const m = /^(\d{1,7})-(\d)$/.exec(String(code ?? '').trim())
  if (!m) return false
  const digits = m[1].split('').map(Number).reverse()
  let sum = 0
  digits.forEach((d, i) => { const v = i % 2 === 0 ? d * 2 : d; sum += v > 9 ? v - 9 : v })
  return (10 - (sum % 10)) % 10 === Number(m[2])
}

const VD = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5], [2, 3, 4, 0, 1, 7, 8, 9, 5, 6], [3, 4, 0, 1, 2, 8, 9, 5, 6, 7], [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1], [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3], [8, 7, 6, 5, 9, 3, 2, 1, 0, 4], [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
]
const VP = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4], [5, 8, 0, 3, 7, 9, 6, 1, 4, 2], [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0], [4, 2, 8, 6, 5, 7, 3, 9, 0, 1], [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
]
export function verhoeffValid(num) {
  let c = 0
  const digits = String(num).split('').map(Number).reverse()
  digits.forEach((d, i) => { c = VD[c][VP[i % 8][d]] })
  return c === 0
}
export function snomedConceptValid(code) {
  const s = String(code ?? '').trim()
  if (!/^\d{6,18}$/.test(s) || s.startsWith('0')) return false
  const partition = s.slice(-3, -1)
  return (partition === '00' || partition === '10') && verhoeffValid(s)
}

/** Validator for a target system (null = no structural check available). */
export function codeValidator(system) {
  if (system === 'http://loinc.org') return { name: 'LOINC 校验位', ok: loincValid }
  if (system === 'http://snomed.info/sct') return { name: 'SNOMED CT 校验位', ok: snomedConceptValid }
  return null
}
