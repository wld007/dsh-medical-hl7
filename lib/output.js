/**
 * 交付格式：
 *   <交付目录>/
 *     bundles/<病人>.json        每位病人一个 transaction Bundle（PUT，编号稳定，可重复导入任何 FHIR 服务器）
 *     ndjson/<资源类型>.ndjson    整批 FHIR Bulk Data 文件（机构、医生去重）
 *     manifest.json              Bulk Data 风格的清单（每个文件的类型、条数），以及来源与规格版本
 */
import { createWriteStream } from 'node:fs'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Resource order inside a bundle: referenced things first. */
const ORDER = ['Organization', 'Practitioner', 'Patient', 'Encounter', 'Specimen', 'Condition', 'Observation', 'DiagnosticReport', 'Procedure', 'MedicationRequest', 'DocumentReference', 'ChargeItem', 'Basic']
const rank = (t) => { const i = ORDER.indexOf(t); return i < 0 ? ORDER.length : i }

export function sortResources(resources) {
  return [...resources].sort((a, b) => rank(a.resourceType) - rank(b.resourceType) || a.id.localeCompare(b.id))
}

export function transactionBundle(resources, { base, id, timestamp }) {
  return {
    resourceType: 'Bundle',
    id,
    meta: { lastUpdated: timestamp },
    type: 'transaction',
    timestamp,
    entry: sortResources(resources).map((r) => ({
      fullUrl: `${base}/${r.resourceType}/${r.id}`,
      resource: r,
      request: { method: 'PUT', url: `${r.resourceType}/${r.id}` },
    })),
  }
}

/** Safe file name for a patient folder/bundle. */
export const safeName = (s) => String(s).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').slice(0, 120) || '_'

/** Append-only NDJSON writer per resource type, deduplicating shared resources by id. */
export function createBulkWriter(dir) {
  const streams = new Map()
  const counts = {}
  const seen = new Set()
  let ready = null
  async function ensure() { if (!ready) ready = mkdir(dir, { recursive: true }); await ready }
  async function write(resources) {
    await ensure()
    for (const r of resources) {
      const k = `${r.resourceType}/${r.id}`
      if (seen.has(k)) continue
      seen.add(k)
      let s = streams.get(r.resourceType)
      if (!s) { s = createWriteStream(join(dir, `${r.resourceType}.ndjson`), { flags: 'a' }); streams.set(r.resourceType, s) }
      if (!s.write(`${JSON.stringify(r)}\n`)) await new Promise((res) => s.once('drain', res))
      counts[r.resourceType] = (counts[r.resourceType] ?? 0) + 1
    }
  }
  async function close() {
    await Promise.all([...streams.values()].map((s) => new Promise((res, rej) => s.end((e) => (e ? rej(e) : res())))))
    return counts
  }
  return { write, close, counts }
}

export async function writeBundle(dir, name, bundle) {
  await mkdir(dir, { recursive: true })
  const path = join(dir, `${safeName(name)}.json`)
  await writeFile(path, JSON.stringify(bundle))
  return path
}

export async function writeManifest(dir, { counts, run, profiles }) {
  const manifest = {
    format: 'dsh-medical-hl7/0',
    fhirVersion: '4.0.1',
    transactionTime: run.finishedAt ?? new Date().toISOString(),
    requiresAccessToken: false,
    output: Object.entries(counts).sort().map(([type, count]) => ({ type, url: `ndjson/${type}.ndjson`, count })),
    error: [],
    producer: { name: 'dsh-medical-hl7', runId: run.id, namespace: run.namespace, timezone: run.timezone },
    source: { input: run.inputName, anonymizer: run.provenance ?? null },
    profiles: profiles.map((p) => ({ id: p.id, version: p.version ?? null, name: p.name ?? null })),
  }
  await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2))
  return manifest
}

export async function readJson(p) { return JSON.parse(await readFile(p, 'utf8')) }
