/**
 * 录 README 动画：虚构数据（test/fixtures）＋本机假模型端点，在 DSH 之外的预览页上真跑一批，
 * 用本机 Chrome（DevTools 协议，不需要 Playwright）逐帧截图到 <outDir>/frames，
 * 再由 scripts/readme-demo.py 合成动画 WebP。不碰任何真实病历。
 *
 *   REACT_UMD_DIR=<含 react.js、react-dom.js 的目录> node scripts/readme-demo.mjs <outDir> [病人数]
 *   python3 scripts/readme-demo.py <outDir> assets/demo.webp
 *
 * 环境变量：DEMO_THEME=dark|light，DEMO_DELAY_MS（假模型每次回答的延迟，默认 260），CHROME（Chrome 可执行文件）。
 */
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeDemoPatient } from './demo-data.mjs'
import { startFakeModels } from './fake-models.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const outDir = process.argv[2]
const patients = Number(process.argv[3] ?? 16)
if (!outDir || !process.env.REACT_UMD_DIR) { console.error('usage: REACT_UMD_DIR=<dir> node scripts/readme-demo.mjs <outDir> [病人数]'); process.exit(1) }
const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const W = 1440, H = 900

const work = await mkdtemp(join(tmpdir(), 'hl7-demo-'))
// 放成匿名化插件交付目录的样子（来源显示为“匿名化正式交付”）
const anon = join(work, '_medical-anonymizer')
await mkdir(join(anon, '_records', 'runs'), { recursive: true })
const input = join(anon, 'output', '虚构病人')
for (let i = 0; i < patients; i++) await writeDemoPatient(join(input, `病人${String(i + 1).padStart(2, '0')}`), i)
const models = await startFakeModels({ delayMs: Number(process.env.DEMO_DELAY_MS ?? 700) })
const port = 18800 + Math.floor(Math.random() * 500)
const config = { outputRoot: join(work, '_medical-hl7'), baseURL: models.baseURL, model: 'qwen3.6-35b-a3b', verifyModel: 'gemma-4-26b-a4b-it', modelConcurrency: 2, maxRounds: 2 }
const server = spawn(process.execPath, [join(root, 'scripts/preview-page.mjs'), join(work, 'state'), String(port)], { env: { ...process.env, PREVIEW_CONFIG: JSON.stringify(config) }, stdio: ['ignore', 'pipe', 'inherit'] })
await new Promise((r) => server.stdout.once('data', r))
const base = `http://127.0.0.1:${port}`
const rpc = async (m, p = {}) => (await (await fetch(`${base}/rpc/${m}`, { method: 'POST', body: JSON.stringify(p) })).json()).value

// Chrome（无头）+ DevTools 协议
const cdpPort = 19300 + Math.floor(Math.random() * 500)
const prof = await mkdtemp(join(tmpdir(), 'hl7-demo-chrome-'))
const browser = spawn(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${prof}`, `--window-size=${W},${H}`, 'about:blank'], { stdio: 'ignore' })
let target = null
for (let i = 0; i < 50 && !target; i++) { await new Promise((r) => setTimeout(r, 200)); try { target = (await (await fetch(`http://127.0.0.1:${cdpPort}/json`)).json()).find((t) => t.type === 'page') } catch { /* starting */ } }
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r, { once: true }))
let seq = 0; const pending = new Map()
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } })
const cdp = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })) })
const evaluate = (expr) => cdp('Runtime.evaluate', { expression: expr, awaitPromise: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
await cdp('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false })

const frames = join(outDir, 'frames')
await rm(frames, { recursive: true, force: true }); await mkdir(frames, { recursive: true })
const timeline = []
let n = 0
const snap = async (ms) => {
  const { result } = await cdp('Page.captureScreenshot', { format: 'png' })
  const f = `f${String(n++).padStart(4, '0')}.png`
  await writeFile(join(frames, f), Buffer.from(result.data, 'base64'))
  timeline.push({ f, ms })
}
const click = (texts) => evaluate(`(async () => { for (const t of ${JSON.stringify(texts)}) { const el = [...document.querySelectorAll('button,.hx-li,.hx-tab')].find((x) => x.textContent.includes(t)); if (el) el.click(); await new Promise((r) => setTimeout(r, 500)) } })()`)

try {
  await cdp('Page.navigate', { url: `${base}/?theme=${process.env.DEMO_THEME ?? 'dark'}` })
  await sleep(1500)
  const { runId } = await rpc('start', { inputDir: input })
  console.log('批次', runId)
  await cdp('Page.reload'); await sleep(900)
  for (let i = 0; i < 600; i++) {
    await snap(400)
    const { run } = await rpc('status', { runId })
    if (run.status !== 'running') { console.log('结束', run.status, run.totals?.resources, '个资源'); break }
    await sleep(420)
  }
  await sleep(1200)
  await snap(3200)
  await click(['规则复核']); await sleep(900); await snap(2600)
  await click(['随访记录']); await sleep(700); await snap(2800)
  await click(['规则库', '② 值域对照', '整个规则库']); await sleep(1200); await snap(2600)
  await click(['◈ 流水线']); await sleep(900); await snap(1800)
} finally {
  await writeFile(join(outDir, 'timeline.json'), JSON.stringify(timeline, null, 1))
  ws.close(); browser.kill(); server.kill(); models.close()
  await rm(work, { recursive: true, force: true }); await rm(prof, { recursive: true, force: true })
}
console.log(`${timeline.length} 帧 → ${frames}`)
process.exit(0)
