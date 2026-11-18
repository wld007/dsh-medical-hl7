/**
 * 在 DSH 之外预览页面：用真实的批次服务回答页面的 RPC，React 从本机的 UMD 文件读。
 *
 *   REACT_UMD_DIR=<含 react.js、react-dom.js 或 react/umd 的目录> node scripts/preview-page.mjs <stateDir> [port]
 *   打开 http://127.0.0.1:<port>/?theme=dark
 *
 * PREVIEW_CONFIG：插件设置（JSON），如 '{"baseURL":"http://127.0.0.1:1234/v1","model":"m"}'，让页面上能真跑批次。
 */
import http from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createService } from '../lib/service.js'
import { createDispatch } from '../lib/rpc.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const stateDir = process.argv[2]
const port = Number(process.argv[3] ?? 18769)
const umd = process.env.REACT_UMD_DIR
if (!stateDir || !umd) { console.error('usage: REACT_UMD_DIR=<dir> node scripts/preview-page.mjs <stateDir> [port]'); process.exit(1) }
const service = createService({ stateDir, config: JSON.parse(process.env.PREVIEW_CONFIG || '{}') })
const dispatch = createDispatch(service, { version: process.env.PREVIEW_VERSION ?? JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version })

async function firstFile(...paths) { for (const p of paths) { try { await stat(p); return p } catch { /* next */ } } throw new Error(`找不到 ${paths[0]}`) }
const reactJs = await firstFile(join(umd, 'react.js'), join(umd, 'react/umd/react.production.min.js'))
const reactDomJs = await firstFile(join(umd, 'react-dom.js'), join(umd, 'react-dom/umd/react-dom.production.min.js'))

// DSH 主题变量的近似值（深色、浅色）
const page = `<!doctype html><meta charset="utf-8"><title>HL7 标准化流水线 · 预览</title>
<style>html,body,#root{margin:0;height:100%}
:root{--dsw-alias-bg-base:#ffffff;--dsw-alias-bg-layer-1:#ffffff;--dsw-alias-bg-layer-2:#f4f6f7;--dsw-alias-border-l1:#e6eaec;--dsw-alias-border-l2:#d5dbde;--dsw-alias-label-primary:#1b2a2f;--dsw-alias-label-secondary:#5d6e73;--dsw-alias-brand-primary:#6d4ae0;--dsw-alias-state-success-primary:#1f9d55;--dsw-alias-state-warn-primary:#d98a00;--dsw-alias-state-error-primary:#d6453d;--dsw-alias-state-idle-primary:#9aa5a9}
:root.dark{--dsw-alias-bg-base:#141414;--dsw-alias-bg-layer-1:#1b1b1b;--dsw-alias-bg-layer-2:#232323;--dsw-alias-border-l1:#2a2a2a;--dsw-alias-border-l2:#3a3a3a;--dsw-alias-label-primary:#eaeaea;--dsw-alias-label-secondary:#a0a0a0}
body{background:var(--dsw-alias-bg-base);font-family:-apple-system,"PingFang SC",sans-serif}</style>
<script>if (new URLSearchParams(location.search).get('theme') !== 'light') document.documentElement.classList.add('dark')</script>
<div id="root"></div>
<script src="/react.js"></script><script src="/react-dom.js"></script>
<script>let def = null; window.__ModuleLoader__ = { load(d) { def = d } }</script>
<script src="/client.js"></script>
<script>
  const plugin = def.factory((name) => (name === 'react' ? React : {}))
  let Page = null
  plugin.apply({
    get(name) { return name === 'connection' ? { rpc: { call: (_c, endpoint, payload) => fetch('/rpc/' + endpoint, { method: 'POST', body: JSON.stringify(payload ?? {}) }).then((r) => r.json()) } } : null },
    slots: { inject: (_n, fn) => { fn(); return () => {} }, register: (opts, c) => { if (opts.name === 'main') Page = c; return () => {} } },
    effect: () => {},
  })
  ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Page))
</script>`

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x')
    if (url.pathname.startsWith('/rpc/')) {
      let body = ''
      for await (const c of req) body += c
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(await dispatch(url.pathname.slice(5), JSON.parse(body || '{}'))))
      return
    }
    const files = { '/react.js': reactJs, '/react-dom.js': reactDomJs, '/client.js': join(root, 'client.js') }
    if (files[url.pathname]) { res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' }); res.end(await readFile(files[url.pathname])); return }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(page)
  } catch (e) { res.writeHead(500); res.end(String(e?.stack ?? e)) }
}).listen(port, '127.0.0.1', () => console.log(`http://127.0.0.1:${port}/`))
