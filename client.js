window.__ModuleLoader__.load({
  id: 'dsh-medical-hl7',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useCallback, useMemo, useRef } = React
    const CHANNEL = '/medical-hl7'
    const PANEL_ID = 'medical-hl7'
    const TITLE = 'HL7 数据交换'
    const services = { ctx: null }

    /* ------------------------------------------------------------------ rpc */
    function call(endpoint, payload) {
      const connection = services.ctx?.get('connection')
      if (!connection?.rpc) return Promise.reject(new Error('connection unavailable'))
      return connection.rpc.call(CHANNEL, endpoint, payload ?? {}).then((r) => {
        if (!r || r.ok !== true) throw new Error(r?.error?.message ?? 'RPC failed')
        return r.value
      })
    }
    const msg = (e) => String(e?.message ?? e)
    function useAsync(fn, deps) {
      const [state, setState] = useState({ loading: true, value: null, error: null })
      useEffect(() => {
        let alive = true
        setState((s) => ({ ...s, loading: true }))
        Promise.resolve().then(fn).then((value) => alive && setState({ loading: false, value, error: null }), (error) => alive && setState({ loading: false, value: null, error: msg(error) }))
        return () => { alive = false }
      }, deps)
      return state
    }

    /* ---------------------------------------------------------------- style */
    const CSS = `
.hx{--bg:var(--dsw-alias-bg-base);--panel:var(--dsw-alias-bg-layer-1);--panel2:var(--dsw-alias-bg-layer-2);--panel3:color-mix(in srgb,var(--dsw-alias-brand-primary) 10%,var(--dsw-alias-bg-layer-2));--line:var(--dsw-alias-border-l1);--line2:var(--dsw-alias-border-l2);--ink:var(--dsw-alias-label-primary);--ink2:var(--dsw-alias-label-secondary);--ink3:color-mix(in srgb,var(--dsw-alias-label-secondary) 72%,transparent);--teal:var(--dsw-alias-brand-primary);--teal2:var(--dsw-alias-brand-primary);--tealdim:color-mix(in srgb,var(--dsw-alias-brand-primary) 13%,transparent);--ok:var(--dsw-alias-state-success-primary);--warn:var(--dsw-alias-state-warn-primary);--bad:var(--dsw-alias-state-error-primary);--idle:var(--dsw-alias-state-idle-primary);--tint:color-mix(in srgb,var(--dsw-alias-brand-primary) 9%,var(--dsw-alias-bg-layer-1));--mono:"SF Mono","JetBrains Mono",Menlo,monospace;
  height:100%;box-sizing:border-box;background:var(--bg);color:var(--ink);font:12.5px -apple-system,"PingFang SC","Helvetica Neue",sans-serif;display:flex;flex-direction:column;gap:8px;padding:8px 10px 10px;overflow:hidden}
.hx *{box-sizing:border-box}
.hx.hx-light{--teal:#0e9f98;--teal2:#08857f;--tealdim:rgba(14,159,152,.12);--bg:color-mix(in srgb,var(--dsw-alias-bg-base) 86%,#0e9f98);--panel:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 93%,#0e9f98);--panel2:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 86%,#0e9f98);--panel3:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 80%,#0e9f98);--line:color-mix(in srgb,var(--dsw-alias-border-l1) 85%,#0e9f98);--line2:color-mix(in srgb,var(--dsw-alias-border-l2) 80%,#0e9f98);--tint:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 85%,#0e9f98)}
.hx.hx-dark{--bg:#081116;--panel:#0d1a20;--panel2:#112128;--panel3:#16282f;--line:#1a2c34;--line2:#26404a;--ink:#e2eef0;--ink2:#8ba5ad;--ink3:#58717a;--teal:#22c7c0;--teal2:#7fe9e2;--tealdim:rgba(34,199,192,.14);--ok:#46d17f;--warn:#f5a524;--bad:#f05252;--tint:#0f2329;color-scheme:dark}
.hx.hx-dark .hx-frame{box-shadow:none}

.hx-frame{border:1px solid var(--line);background:var(--panel);border-radius:6px;box-shadow:0 1px 2px color-mix(in srgb,var(--dsw-alias-label-primary) 6%,transparent)}
.hx-top{display:flex;align-items:center;gap:14px;padding:8px 14px;background:linear-gradient(90deg,var(--tint),var(--panel) 40%)}
.hx-logo{width:28px;height:28px;border-radius:7px;background:var(--teal);display:grid;place-items:center;flex:none}
.hx-brand b{display:block;font-size:14px;letter-spacing:2px}.hx-brand span{font-family:var(--mono);font-size:9.5px;color:var(--ink2);letter-spacing:1px}
.hx-runbox{border:1px solid var(--line2);border-radius:6px;padding:3px 10px;line-height:1.35;min-width:220px}
.hx-sp{flex:1}
.hx-btn{border:1px solid var(--line2);border-radius:5px;padding:4px 11px;color:var(--ink);background:var(--panel2);font-size:12px;cursor:pointer;white-space:nowrap}
.hx-btn:hover{border-color:var(--teal)}.hx-btn:disabled{opacity:.45;cursor:default}
.hx-btn.pri{border-color:var(--teal);color:var(--teal2);background:var(--tealdim)}
.hx-btn.sm{padding:1px 7px;font-size:11px}
.hx-tabs{display:flex;gap:2px;padding:0 8px;flex:none;overflow-x:auto}
.hx-tab{padding:8px 12px;color:var(--ink2);font-size:13px;border:0;border-bottom:2px solid transparent;background:none;cursor:pointer;white-space:nowrap}
.hx-tab.on{color:var(--ink);border-bottom-color:var(--teal);font-weight:600}
.hx-tab i{font-style:normal;font-family:var(--mono);font-size:11px;margin-left:5px;color:var(--warn)}
.hx-body{flex:1;min-height:0;display:flex;gap:8px}
.hx-col{display:flex;flex-direction:column;gap:8px;min-height:0}
.hx-scroll{overflow:auto;min-height:0}
.hx-pad{padding:12px 14px}
.hx-h{display:flex;align-items:baseline;gap:10px;margin-bottom:8px}.hx-h b{font-size:13px;letter-spacing:1px}
.hx-cap{font-family:var(--mono);font-size:10px;letter-spacing:1.6px;text-transform:uppercase;color:var(--ink3)}
.hx-num{font-family:var(--mono)}
.hx-muted{color:var(--ink2)}.hx-faint{color:var(--ink3)}.hx-ok{color:var(--ok)}.hx-warn{color:var(--warn)}.hx-bad{color:var(--bad)}
.hx-chip{display:inline-block;border-radius:3px;padding:0 6px;font-size:10.5px;line-height:17px;border:1px solid var(--line2);color:var(--ink2);white-space:nowrap;margin-right:4px}
.hx-chip.ok{color:var(--ok);border-color:color-mix(in srgb,var(--ok) 45%,transparent);background:color-mix(in srgb,var(--ok) 9%,transparent)}
.hx-chip.w{color:var(--warn);border-color:color-mix(in srgb,var(--warn) 50%,transparent);background:color-mix(in srgb,var(--warn) 9%,transparent)}
.hx-chip.b{color:var(--bad);border-color:color-mix(in srgb,var(--bad) 50%,transparent);background:color-mix(in srgb,var(--bad) 9%,transparent)}
.hx-chip.vio{color:#8b6cf0;border-color:color-mix(in srgb,#8b6cf0 50%,transparent);background:color-mix(in srgb,#8b6cf0 10%,transparent)}
.hx-draft{border:1px solid var(--line2);border-radius:6px;padding:8px 10px;margin:6px 0;background:var(--panel2)}
.hx-chip.t{color:var(--teal);border-color:color-mix(in srgb,var(--teal) 50%,transparent);background:var(--tealdim)}
.hx table{border-collapse:collapse;width:100%}
.hx td,.hx th{padding:5px 8px;text-align:left;border-bottom:1px solid var(--line);vertical-align:top}
.hx th{font-weight:500;color:var(--ink3);font-size:11px;position:sticky;top:0;background:var(--panel);z-index:1}
.hx tr.click{cursor:pointer}.hx tr.click:hover td{background:var(--panel2)}
.hx tr.sel td{background:var(--panel3)}
.hx-input{background:var(--panel2);border:1px solid var(--line2);border-radius:5px;color:var(--ink);padding:5px 8px;font-size:12px;min-width:0}
.hx-input:focus{outline:none;border-color:var(--teal)}
.hx-field{display:flex;flex-direction:column;gap:4px;font-size:11.5px;color:var(--ink2)}
.hx-err{color:var(--bad);border:1px solid color-mix(in srgb,var(--bad) 40%,transparent);background:color-mix(in srgb,var(--bad) 8%,transparent);padding:6px 10px;border-radius:5px;cursor:pointer}
.hx-empty{color:var(--ink3);padding:30px;text-align:center}
.hx-st{position:relative;flex:1;min-width:96px;border:1px solid var(--line2);border-radius:8px;background:linear-gradient(180deg,var(--tint),var(--panel));padding:10px;min-height:118px}
.hx-st .no{font-family:var(--mono);font-size:9.5px;color:var(--ink3);letter-spacing:1px}.hx-st .nm{font-size:14px;font-weight:700;margin:2px 0}
.hx-st .sub{font-size:10.5px;color:var(--ink3);line-height:14px;min-height:28px}.hx-st .big{font-family:var(--mono);font-size:19px;font-weight:700;margin-top:6px}
.hx-st .big small{font-size:10px;color:var(--ink3);font-weight:400;margin-left:3px}
.hx-st .bar{position:absolute;left:0;right:0;top:-1px;height:3px;border-radius:8px 8px 0 0;background:var(--line2);overflow:hidden}.hx-st .bar span{display:block;height:100%;background:var(--ok)}
.hx-st.run{border-color:var(--teal);box-shadow:0 0 0 1px color-mix(in srgb,var(--teal) 25%,transparent),0 0 24px color-mix(in srgb,var(--teal) 20%,transparent)}.hx-st.run .bar span{background:var(--teal)}
.hx-st.hold{border-color:color-mix(in srgb,var(--warn) 70%,transparent)}.hx-st.hold .bar span{background:var(--warn)}
.hx-st.idle{opacity:.55}
.hx-iso-wrap{position:relative;border:1px solid var(--line);border-radius:6px;overflow:hidden;background:radial-gradient(ellipse at 45% 55%,var(--tealdim),transparent 62%),var(--panel)}
.hx-iso{display:block;width:100%;height:auto;max-height:420px}
.hx-st{cursor:pointer}.hx-st-hit{fill:transparent}.hx-st:hover polygon{filter:brightness(1.12)}
@keyframes hx-blink{0%,100%{opacity:.95}50%{opacity:.35}}.hx-blink{animation:hx-blink 1.2s infinite}
.hx-legend{display:flex;gap:12px;align-items:center;font-size:11px;color:var(--ink2);margin-top:6px}
.hx-legend i{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:4px;vertical-align:-1px}
.hx-lg-done{background:var(--ok)}.hx-lg-active{background:var(--teal)}.hx-lg-warn{background:var(--warn)}.hx-lg-idle{background:var(--line2)}
.hx-ov{flex:1;min-height:0;display:flex;flex-direction:column;gap:8px}
.hx-ov-top{flex:1;min-height:0;display:flex;gap:8px}
.hx-ov-stage{flex:1;min-width:0;position:relative;display:flex;flex-direction:column;padding:10px 12px 8px}
.hx-ov-head{display:flex;align-items:baseline;gap:10px;flex:none}.hx-ov-head b{font-size:13px;letter-spacing:1px}
.hx-ov-head .hx-legend{margin:0 0 0 auto}
.hx-ov-stage .hx-iso-wrap{flex:1;min-height:0;margin-top:6px;border:0;background:radial-gradient(ellipse at 45% 55%,var(--tealdim),transparent 62%)}
.hx-ov-stage .hx-iso{width:100%;height:100%;max-height:none}
.hx-ov-foot{flex:none;font-size:11px;text-align:right}
.hx-ov-side{width:320px;flex:none}
.hx-ov-bottom{flex:none;height:150px;display:flex;gap:8px}.hx-ov-bottom>.hx-frame{flex:1;min-width:0;overflow:hidden}
.hx-alerts{position:absolute;bottom:28px;left:14px;width:320px;border:1px solid var(--line2);border-radius:6px;background:color-mix(in srgb,var(--panel) 92%,transparent);padding:8px 10px;display:flex;flex-direction:column;gap:6px;backdrop-filter:blur(4px)}
.hx-alerts-h{display:flex;align-items:center;gap:6px}.hx-alerts-h i{width:7px;height:7px;border-radius:50%;background:var(--warn)}
.hx-alert{display:flex;gap:8px;align-items:center;justify-content:space-between;border-left:3px solid var(--warn);padding:2px 0 2px 8px}
.hx-alert.b{border-left-color:var(--bad)}
.hx-alert-t{font-weight:600;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.hx-alert-s{font-size:11px;color:var(--ink2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.hx-tiles{display:grid;grid-template-columns:1fr 1fr;gap:6px}.hx-tiles>div{border:1px solid var(--line);border-radius:6px;padding:6px 10px;background:var(--panel2)}
.hx-tiles small{display:block;color:var(--ink3);font-size:11px}.hx-tiles b{font-size:20px}
.hx-stage-rows{display:flex;flex-direction:column;gap:4px}.hx-stage-rows>div{display:grid;grid-template-columns:96px 1fr auto;gap:8px;align-items:center;font-size:12px;padding:5px 6px;border-radius:5px;cursor:pointer}
.hx-stage-rows>div:hover{background:var(--panel2)}
.hx-kv-tight{gap:4px 10px;font-size:11.5px}.hx-kv-tight span:nth-child(2n){white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.hx-bars2{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px 18px}.hx-bars2>div{display:grid;grid-template-columns:72px 1fr 56px;gap:8px;align-items:center;font-size:11.5px}
.hx-bars2 .track{height:7px;background:var(--line);border-radius:3px;overflow:hidden}.hx-bars2 .track span{display:block;height:100%;background:var(--teal)}.hx-bars2>div>span:last-child{text-align:right}
.hx-arrow{align-self:center;color:var(--ink3)}
.hx-cells{display:grid;grid-template-columns:repeat(auto-fill,minmax(14px,1fr));gap:3px}
.hx-cells i{height:12px;border-radius:2px;background:var(--line2);cursor:pointer}
.hx-cells i.o{background:var(--ok)}.hx-cells i.r{background:var(--teal)}.hx-cells i.w{background:var(--warn)}
.hx-bigs{display:flex;gap:22px;margin:4px 0 8px;flex-wrap:wrap}.hx-bigs div small{display:block;color:var(--ink3);font-size:11px}.hx-bigs div .hx-num{font-size:24px;font-weight:700}
.hx-bars{display:grid;grid-template-columns:auto 1fr auto;gap:4px 10px;align-items:center;font-size:11.5px}
.hx-bars .track{height:8px;background:var(--line);border-radius:3px;overflow:hidden}.hx-bars .track span{display:block;height:100%;background:var(--teal)}
.hx-list{display:flex;flex-direction:column;gap:1px}
.hx-li{padding:5px 8px;border-radius:5px;cursor:pointer;display:flex;justify-content:space-between;gap:8px}
.hx-li:hover{background:var(--panel2)}.hx-li.on{background:var(--panel3);box-shadow:inset 3px 0 0 var(--teal)}
.hx-json{white-space:pre-wrap;word-break:break-all;font-family:var(--mono);font-size:11.5px;line-height:1.55;color:var(--ink)}
.hx-json .k{color:var(--teal)}.hx-json .s{color:color-mix(in srgb,var(--warn) 80%,var(--ink))}.hx-json .n{color:color-mix(in srgb,var(--ok) 70%,var(--ink))}
.hx-text{white-space:pre-wrap;font-size:13px;line-height:1.8;border:1px solid var(--line2);border-radius:6px;padding:8px 10px;background:var(--panel2);margin-bottom:8px}
.hx-md{white-space:pre-wrap;font-family:var(--mono);font-size:12px;line-height:1.6}
.hx-kv{display:grid;grid-template-columns:auto 1fr;gap:3px 12px;font-size:11.5px}
.hx-sec{border-left:3px solid var(--teal);background:linear-gradient(90deg,var(--tealdim),transparent 70%);padding:4px 10px;margin:12px 0 8px;display:flex;gap:8px;align-items:baseline}
.hx-sec b{font-size:12.5px}
.hx-settings{max-width:820px;display:flex;flex-direction:column;gap:12px;color:var(--dsw-alias-label-primary)}
.hx-settings .hx-input{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2)}
.hx-settings .hx-btn{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2)}
.hx-settings .hx-field{color:var(--dsw-alias-label-secondary)}
.hx-grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
`

    /* -------------------------------------------------------------- helpers */
    const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString())
    const fmtMs = (ms) => (ms == null ? '—' : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`)
    const STATUS = { completed: ['完成', 'ok'], running: ['运行中', 't'], review: ['有需关注项', 'w'], failed: ['失败', 'b'], cancelled: ['已取消', 'b'] }
    const statusChip = (s) => h('span', { className: `hx-chip ${STATUS[s]?.[1] ?? ''}` }, STATUS[s]?.[0] ?? s)
    const TYPE_ZH = { Patient: '病人', Encounter: '就诊', Condition: '诊断', Observation: '观察/检验', DiagnosticReport: '报告', Specimen: '标本', Procedure: '手术操作', DocumentReference: '文书', MedicationRequest: '医嘱', ChargeItem: '费用', Basic: '通用(未映射表)', Organization: '机构/科室', Practitioner: '医务人员' }
    const TYPE_ORDER = Object.keys(TYPE_ZH)
    const byOrder = (a, b) => (TYPE_ORDER.indexOf(a) + 1 || 99) - (TYPE_ORDER.indexOf(b) + 1 || 99)
    const shortTime = (s) => (s ? String(s).replace('T', ' ').replace(/:\d{2}([+-]\d{2}:\d{2}|Z)$/, '').replace(/([+-]\d{2}:\d{2}|Z)$/, '') : '—')

    function Icon({ size = 16 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' },
        h('rect', { x: 4, y: 3, width: 13, height: 18, rx: 2 }), h('path', { d: 'M10.5 8v6M7.5 11h6' }), h('path', { d: 'M15 17h6m-2.5-2.5L21 17l-2.5 2.5' }))
    }

    /** Tiny JSON highlighter (escapes text; no innerHTML). */
    function Json({ value }) {
      const text = JSON.stringify(value, null, 2)
      const parts = []
      const re = /("(?:[^"\\]|\\.)*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|(true|false|null)/g
      let last = 0; let m; let i = 0
      while ((m = re.exec(text))) {
        if (m.index > last) parts.push(text.slice(last, m.index))
        if (m[1]) parts.push(h('span', { key: i++, className: m[2] ? 'k' : 's' }, m[1]), m[2] ?? '')
        else parts.push(h('span', { key: i++, className: 'n' }, m[0]))
        last = re.lastIndex
      }
      parts.push(text.slice(last))
      return h('div', { className: 'hx-json' }, parts)
    }


    /** Is the Harness currently dark? Reads the host background token's luminance. */
    function hostIsDark(el) {
      try {
        const host = el ?? document.documentElement
        let color = getComputedStyle(host).getPropertyValue('--dsw-alias-bg-base').trim()
        if (!color) color = getComputedStyle(document.body).backgroundColor
        const probe = document.createElement('span')
        probe.style.color = color
        document.body.appendChild(probe)
        const rgb = getComputedStyle(probe).color
        probe.remove()
        const parts = (rgb.match(/[\d.]+/g) ?? []).map(Number)
        if (parts.length < 3) throw new Error('no colour')
        const scale = rgb.startsWith('color(') ? 255 : 1
        const [r, g, b] = parts
        return (0.2126 * r + 0.7152 * g + 0.0722 * b) * scale / 255 < 0.5
      } catch {
        return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
      }
    }
    function useHostDark(ref) {
      const [dark, setDark] = useState(() => hostIsDark(null))
      useEffect(() => {
        const check = () => setDark(hostIsDark(ref.current?.parentElement ?? null))
        check()
        const observer = new MutationObserver(check)
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'data-color-scheme'] })
        if (document.body) observer.observe(document.body, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] })
        const media = window.matchMedia?.('(prefers-color-scheme: dark)')
        media?.addEventListener?.('change', check)
        return () => { observer.disconnect(); media?.removeEventListener?.('change', check) }
      }, [])
      return dark
    }

    /* ================================================================ page */
    function Page() {
      const [tab, setTab] = useState('overview')
      const [runs, setRuns] = useState([])
      const [runId, setRunId] = useState(null)
      const [run, setRun] = useState(null)
      const [patient, setPatient] = useState(null)
      const [error, setError] = useState('')
      const [showNew, setShowNew] = useState(false)
      const rootRef = useRef(null)
      const dark = useHostDark(rootRef)

      const refreshList = useCallback(async () => {
        try {
          const v = await call('list')
          setRuns(v.runs)
          setRunId((cur) => cur ?? v.active ?? v.runs[0]?.id ?? null)
          if (!v.runs.length) setShowNew(true)
        } catch (e) { setError(msg(e)) }
      }, [])
      useEffect(() => { refreshList() }, [])

      useEffect(() => {
        if (!runId) return undefined
        let alive = true; let timer = null
        const load = async () => {
          try {
            const v = await call('status', { runId })
            if (!alive) return
            setRun(v.run)
            setPatient((p) => p ?? v.run?.patients?.[0]?.name ?? null)
            if (v.run?.status === 'running') timer = setTimeout(load, 1500)
            else refreshList()
          } catch (e) { if (alive) setError(msg(e)) }
        }
        load()
        return () => { alive = false; clearTimeout(timer) }
      }, [runId])

      const openPatient = (name, next = 'resources') => { setPatient(name); setTab(next) }
      const t = run?.totals
      const st = run?.stages
      const tabs = [['overview', '◈ 概览'], ['schema', '① Schema 同构'], ['domains', '② 值域归一', st ? (st.domains.pending + st.domains.unmapped) || null : null], ['terms', '③ 术语对照'], ['patients', '病人', t?.held || null], ['resources', '资源浏览'], ['model', '模型调用'], ['report', '报告']]
      const rerun = () => call('rerun', { runId: run.id }).then((v) => { setRunId(v.runId); setRun(null); refreshList() }).catch((e) => setError(msg(e)))
      return h('div', { className: `hx ${dark ? 'hx-dark' : 'hx-light'}`, ref: rootRef },
        h('style', {}, CSS),
        h('div', { className: 'hx-frame hx-top' },
          h('div', { className: 'hx-logo' }, h('svg', { width: 17, height: 17, viewBox: '0 0 24 24', fill: 'none', style: { stroke: 'var(--dsw-alias-bg-base)' }, strokeWidth: 2.4, strokeLinecap: 'round' }, h('path', { d: 'M12 5v14M5 12h14' }))),
          h('div', { className: 'hx-brand' }, h('b', {}, TITLE), h('span', {}, 'HL7 FHIR R4 EXCHANGE')),
          run ? h('div', { className: 'hx-runbox' },
            h('b', {}, statusChip(run.status), run.current ? `${run.current.unit} · ${run.current.step}` : `${fmt(t.patients)} 位病人 · ${fmt(t.resources)} 个资源`),
            h('div', { className: 'hx-num hx-muted', style: { fontSize: 11 } }, run.id)) : null,
          h('div', { className: 'hx-sp' }),
          run?.status === 'running' ? h('button', { className: 'hx-btn', onClick: () => call('cancel', { runId: run.id }).catch((e) => setError(msg(e))) }, '取消批次') : null,
          run && ['cancelled', 'failed'].includes(run.status) ? h('button', { className: 'hx-btn', onClick: () => call('start', { resumeFrom: run.id }).then(() => { setRun(null); setRunId(null); setTimeout(() => setRunId(run.id), 0) }).catch((e) => setError(msg(e))) }, '继续处理') : null,
          h('button', { className: 'hx-btn pri', onClick: () => setShowNew((x) => !x) }, '＋ 新批次'),
          h('select', { className: 'hx-input', value: runId ?? '', onChange: (e) => { setRunId(e.target.value); setRun(null); setPatient(null) } },
            runs.map((r) => h('option', { key: r.id, value: r.id }, `${r.id} · ${r.input} · ${STATUS[r.status]?.[0] ?? r.status}`)))),
        h('div', { className: 'hx-frame hx-tabs' }, tabs.map(([k, label, n]) => h('button', { key: k, className: `hx-tab${tab === k ? ' on' : ''}`, onClick: () => setTab(k) }, label, n ? h('i', {}, String(n)) : null))),
        error ? h('div', { className: 'hx-err', onClick: () => setError('') }, error, h('span', { className: 'hx-faint' }, '（点击关闭）')) : null,
        showNew ? h(NewRun, { onStarted: (id) => { setShowNew(false); setRunId(id); setRun(null); setPatient(null); refreshList(); setTab('overview') }, onError: setError }) : null,
        h('div', { className: 'hx-body' },
          !run ? h('div', { className: 'hx-frame hx-empty', style: { flex: 1 } }, runs.length ? '加载中…' : '还没有批次。点右上角「＋ 新批次」，选择匿名化后的数据目录开始转换。')
            : tab === 'overview' ? h(Overview, { run, openPatient, onTab: setTab, dark })
              : tab === 'patients' ? h(Patients, { run, patient, setPatient, openPatient })
                : tab === 'resources' ? h(Resources, { run, patient, setPatient })
                  : tab === 'schema' ? h(SchemaTab, { run, onRerun: rerun })
                  : tab === 'domains' ? h(DomainsTab, { run, onRerun: rerun })
                  : tab === 'terms' ? h(TermsTab, { run, onRerun: rerun })
                  : tab === 'model' ? h(ModelTab, { run, onTab: setTab })
                    : h(Report, { run })))
    }

    /* --------------------------------------------------------------- new run */
    function NewRun({ onStarted, onError }) {
      const [inputDir, setInput] = useState('')
      const [outputRoot, setOut] = useState('')
      const [busy, setBusy] = useState(false)
      const pick = async () => { try { const v = await call('pickFolder'); if (v.path) setInput(v.path) } catch (e) { onError(msg(e)) } }
      const start = async () => {
        setBusy(true)
        try { const v = await call('start', { inputDir, outputRoot: outputRoot || undefined }); onStarted(v.runId) } catch (e) { onError(msg(e)) } finally { setBusy(false) }
      }
      return h('div', { className: 'hx-frame hx-pad', style: { display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' } },
        h('label', { className: 'hx-field', style: { flex: 3, minWidth: 280 } }, '输入目录或文件（通常是匿名化插件的交付目录；json / ndjson / csv，字段命名不限）',
          h('div', { style: { display: 'flex', gap: 6 } }, h('input', { className: 'hx-input', style: { flex: 1 }, value: inputDir, onChange: (e) => setInput(e.target.value), placeholder: '/path/to/_medical-anonymizer/…' }), h('button', { className: 'hx-btn', onClick: pick }, '选择…'))),
        h('label', { className: 'hx-field', style: { flex: 2, minWidth: 200 } }, '输出根目录（可空：输入旁的 _medical-hl7）', h('input', { className: 'hx-input', value: outputRoot, onChange: (e) => setOut(e.target.value) })),
        h('button', { className: 'hx-btn pri', disabled: !inputDir || busy, onClick: start }, busy ? '启动中…' : '开始转换'))
    }

    /* ------------------------------------------------------ 2.5D 立体产线 */
    const ISO_DARK = { grid: '#132229', slab: '#14262d', belt: '#21363e', roller: '#2f4952', bDone: '#2c4049', bActive: '#2f4750', bWarn: '#3a3f3c', bIdle: '#1f3036', ok: '#46d17f', acc: '#22c7c0', warn: '#f5a524', vent: '#0b171c', activeTop: '#1f5a5c', warnTop: '#5a4a2a', acc2: '#7fe9e2', cross: '#3d5a64', feeder: '#1b2d33', pileWarn: '#b8781a', pile: '#178d89', pileTop: '#4fd3cb', code: '#58717a', idleText: '#6f8a92', name: '#e2eef0', line: '#8ba5ad', file: '#1aa39d', vio: '#a58bff', stroke: 'rgba(160,230,235,.10)' }
    const ISO_LIGHT = { grid: '#c9d8dc', slab: '#cddcdf', belt: '#b2c6cb', roller: '#93acb2', bDone: '#b4c9ce', bActive: '#9fd6d0', bWarn: '#ebcf96', bIdle: '#c6d5d9', ok: '#1f9d55', acc: '#0e9f98', warn: '#d98a00', vent: '#55717a', activeTop: '#7fd8d0', warnTop: '#f3bd57', acc2: '#08857f', cross: '#86a1a8', feeder: '#a1b9bf', pileWarn: '#e0a23a', pile: '#1bb0a7', pileTop: '#7fe3dc', code: '#7d9298', idleText: '#8aa0a6', name: '#17323a', line: '#4c6870', file: '#18b3aa', vio: '#7b5cf0', stroke: 'rgba(20,60,70,.14)' }
    const ISO_STATIONS = [
      { id: 'read', code: 'S0', name: '读取分组' }, { id: 'schema', code: '①', name: 'Schema 同构' }, { id: 'domains', code: '②', name: '值域归一' },
      { id: 'terms', code: '③', name: '术语对照' }, { id: 'build', code: '④', name: 'FHIR 组装' }, { id: 'gate', code: '验收', name: '验收' }, { id: 'deliver', code: '交付', name: '交付' },
    ]
    /** Isometric production line (same drawing language as the de-identification plugin). */
    function IsoLine({ states, labels, piles, belt, bypass, loop, onStation, dark }) {
      const C = dark ? ISO_DARK : ISO_LIGHT
      const STEP = 152
      const P = (x, y, z = 0) => [120 + x * 0.94 - y * 0.66, 236 + x * 0.26 + y * 0.58 - z]
      const pts = (list) => list.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')
      const shade = (hex, f) => { const n = parseInt(hex.slice(1), 16); return `rgb(${[n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.min(255, Math.round(v * f))).join(',')})` }
      let key = 0
      const poly = (list, fill, extra = {}) => h('polygon', { key: key++, points: pts(list), fill, stroke: C.stroke, strokeWidth: 0.8, ...extra })
      const box = (x, y, z, w, d, hh, base, top) => [
        poly([P(x, y + d, z), P(x + w, y + d, z), P(x + w, y + d, z + hh), P(x, y + d, z + hh)], shade(base, 0.62)),
        poly([P(x + w, y, z), P(x + w, y + d, z), P(x + w, y + d, z + hh), P(x + w, y, z + hh)], shade(base, 0.82)),
        poly([P(x, y, z + hh), P(x + w, y, z + hh), P(x + w, y + d, z + hh), P(x, y + d, z + hh)], top ?? base),
      ]
      const BODY = { done: C.bDone, active: C.bActive, warn: C.bWarn, idle: C.bIdle }
      const LED = { done: C.ok, active: C.acc, warn: C.warn, idle: C.roller }
      const W = STEP * 6 + 150
      const grid = []
      for (let i = -2; i <= 12; i += 1) { const a = P(i * 100, -120); const b = P(i * 100, 260); grid.push(h('line', { key: `gx${i}`, x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: C.grid })) }
      for (let j = -1; j <= 3; j += 1) { const a = P(-200, j * 100 - 20); const b = P(1200, j * 100 - 20); grid.push(h('line', { key: `gy${j}`, x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: C.grid })) }
      const pools = []
      const stations = ISO_STATIONS.map((s, i) => {
        const st = states[s.id] ?? 'idle'
        const x = i * STEP; const y = 20
        const base = BODY[st]; const hot = st === 'active'
        const parts = []
        if (hot || st === 'warn') { const p = P(x + 34, y + 40); pools.push(h('ellipse', { key: `pool${s.id}`, cx: p[0], cy: p[1] + 16, rx: 70, ry: 26, fill: `url(#hx-pool-${st === 'warn' ? 'w' : 'a'})`, filter: 'url(#hx-soft)' })) }
        parts.push(h('polygon', { key: 'hit', className: 'hx-st-hit', fill: 'transparent', points: pts([P(x - 6, y - 6), P(x + 76, y - 6), P(x + 76, y + 92), P(x - 6, y + 92)]) }))
        parts.push(...box(x, y, 0, 70, 66, 26, base))
        for (let v = 0; v < 4; v += 1) parts.push(poly([P(x + 8 + v * 14, y + 66, 8), P(x + 18 + v * 14, y + 66, 8), P(x + 18 + v * 14, y + 66, 18), P(x + 8 + v * 14, y + 66, 18)], C.vent, { stroke: 'none' }))
        const mh = st === 'idle' ? 14 : 20
        parts.push(...box(x + 12, y + 10, 26, 46, 42, mh, base, hot ? C.activeTop : st === 'warn' ? C.warnTop : undefined))
        const zz = 26 + mh + 0.2
        if (hot || st === 'warn') {
          const col = hot ? C.acc2 : C.warn
          for (let gx = 0; gx < 3; gx += 1) for (let gy = 0; gy < 3; gy += 1) {
            const zx = x + 16 + gx * 14; const zy = y + 14 + gy * 12
            parts.push(poly([P(zx, zy, zz), P(zx + 10, zy, zz), P(zx + 10, zy + 8, zz), P(zx, zy + 8, zz)], col, { stroke: 'none', opacity: (gx + gy) % 3 === 0 ? 0.95 : 0.5, filter: 'url(#hx-glow)', className: hot ? 'hx-blink' : '' }))
          }
        } else {
          const cx = x + 35; const cy = y + 31
          parts.push(poly([P(cx - 3, cy - 10, zz), P(cx + 3, cy - 10, zz), P(cx + 3, cy + 10, zz), P(cx - 3, cy + 10, zz)], C.cross, { stroke: 'none' }))
          parts.push(poly([P(cx - 10, cy - 3, zz), P(cx + 10, cy - 3, zz), P(cx + 10, cy + 3, zz), P(cx - 10, cy + 3, zz)], C.cross, { stroke: 'none' }))
        }
        const led = P(x + 64, y + 66, 22)
        parts.push(h('circle', { key: 'led', cx: led[0], cy: led[1], r: 3, fill: LED[st], filter: st === 'idle' ? undefined : 'url(#hx-glow)' }))
        parts.push(...box(x + 26, y + 66, 0, 16, 18, 5, C.feeder))
        const pile = piles[s.id] ?? { n: 0 }
        for (let b = 0; b < Math.min(36, pile.n); b += 1) {
          const lv = Math.floor(b / 6); const a = b % 3; const c = Math.floor((b % 6) / 3)
          parts.push(...box(x + 14 + a * 13, 136 + c * 12, lv * 9, 11, 10, 8, pile.warn ? C.pileWarn : C.pile, pile.warn ? C.warn : C.pileTop))
        }
        return { s, i, st, x, y, parts, mh }
      })
      const labelsSvg = stations.map(({ s, st, x, y, mh }) => {
        const [line1, line2, tone] = labels[s.id] ?? ['', '', '']
        const tip = P(x + 35, y + 31, 26 + mh)
        const top = tip[1] - (line2 ? 78 : 62)
        return h('g', { key: `lb${s.id}`, pointerEvents: 'none' },
          h('line', { x1: tip[0], y1: tip[1] - 4, x2: tip[0], y2: top + (line2 ? 56 : 42), stroke: LED[st], strokeWidth: 1, strokeDasharray: '2 3', opacity: 0.7 }),
          h('text', { x: tip[0], y: top + 2, fill: C.code, fontSize: 11, textAnchor: 'middle', letterSpacing: 1 }, s.code),
          h('text', { x: tip[0], y: top + 21, fill: st === 'idle' ? C.idleText : C.name, fontSize: 16, fontWeight: 600, textAnchor: 'middle' }, s.name),
          h('text', { x: tip[0], y: top + 37, fill: st === 'warn' ? C.warn : st === 'active' ? C.acc2 : C.line, fontSize: 13, textAnchor: 'middle' }, line1),
          line2 ? h('text', { x: tip[0], y: top + 52, fill: tone === 'warn' ? C.warn : C.line, fontSize: 12, textAnchor: 'middle' }, line2) : null)
      })
      const beltBoxes = []
      for (let k = 0; k < belt; k += 1) { const x = 60 + k * 26 + (k % 3) * 3; if (x > W - 120) break; beltBoxes.push(...box(x, 109, 7, 11, 11, 8, C.file, C.acc2)) }
      const rollers = []
      for (let x = -30; x < W - 30; x += 22) { const a = P(x, 104, 7.2); const b = P(x, 126, 7.2); rollers.push(h('line', { key: `r${x}`, x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: C.roller })) }
      // 复核回流：交付之后（页面复核）→ 回到 ② 值域归一 / ③ 术语对照
      const la = P(6 * STEP + 35, 34, 128); const lb = P(2 * STEP + 35, 34, 128)
      const mx = (la[0] + lb[0]) / 2; const my = Math.min(la[1], lb[1]) - 50
      // 旁路：无规格的表自动推断，原样保留为 Basic
      const da = P(STEP * 0 + 40, 205); const db = P(STEP * 4 + 40, 205)
      const dm = P(STEP * 1.9, 199)
      const dAngle = (Math.atan2(db[1] - da[1], db[0] - da[0]) * 180) / Math.PI
      return h('svg', { className: 'hx-iso', viewBox: '-75 140 1240 455', preserveAspectRatio: 'xMidYMid meet', role: 'img', 'aria-label': '处理流程' },
        h('defs', {},
          h('filter', { id: 'hx-glow', x: '-50%', y: '-50%', width: '200%', height: '200%' }, h('feGaussianBlur', { stdDeviation: 3.5, result: 'b' }), h('feMerge', {}, h('feMergeNode', { in: 'b' }), h('feMergeNode', { in: 'SourceGraphic' }))),
          h('filter', { id: 'hx-soft', x: '-50%', y: '-50%', width: '200%', height: '200%' }, h('feGaussianBlur', { stdDeviation: 10 })),
          h('radialGradient', { id: 'hx-pool-a' }, h('stop', { offset: 0, stopColor: C.acc, stopOpacity: 0.55 }), h('stop', { offset: 1, stopColor: C.acc, stopOpacity: 0 })),
          h('radialGradient', { id: 'hx-pool-w' }, h('stop', { offset: 0, stopColor: C.warn, stopOpacity: 0.5 }), h('stop', { offset: 1, stopColor: C.warn, stopOpacity: 0 }))),
        h('g', { opacity: 0.6 }, grid),
        h('g', {}, box(-60, -60, -14, W, 290, 14, C.slab)),
        h('g', {}, pools),
        h('g', {}, box(-40, 104, 0, W - 20, 22, 7, C.belt), rollers),
        h('line', { x1: da[0], y1: da[1], x2: db[0], y2: db[1], stroke: C.vio, strokeWidth: 1.2, strokeDasharray: '5 5', opacity: bypass.active ? 0.85 : 0.35 }),
        h('text', { x: dm[0], y: dm[1], transform: `rotate(${dAngle.toFixed(2)} ${dm[0].toFixed(1)} ${dm[1].toFixed(1)})`, fill: C.vio, fontSize: 13, textAnchor: 'middle', opacity: bypass.active ? 1 : 0.6 }, bypass.label),
        stations.map(({ s, parts }) => h('g', { key: s.id, className: 'hx-st', onClick: () => onStation?.(s.id) }, h('title', {}, `${s.name}（点开查看）`), parts)),
        h('g', { pointerEvents: 'none' }, beltBoxes),
        h('path', { d: `M${la[0]},${la[1]} Q${mx},${my} ${lb[0]},${lb[1]}`, fill: 'none', stroke: C.acc, strokeWidth: 1.3, strokeDasharray: '6 5' }),
        h('path', { d: `M${lb[0] + 9},${lb[1] - 9} L${lb[0]},${lb[1]} L${lb[0] + 12},${lb[1] + 1}`, fill: 'none', stroke: C.acc, strokeWidth: 1.3 }),
        h('text', { x: mx, y: my + 12, fill: C.acc2, fontSize: 13, textAnchor: 'middle' }, loop),
        labelsSvg)
    }

    /* --------------------------------------------------------------- overview */
    /** States, labels and piles of the seven stations, from the run record. */
    function isoProps(run, S, onTab, dark) {
      const t = run.totals
      const running = run.status === 'running'
      const unitsDone = run.units?.length ?? 0
      const pend = S ? S.domains.pending + S.domains.unmapped : 0
      const fin = !running
      const st = (doneCond, warnCond) => (running ? (doneCond ? 'done' : 'active') : warnCond ? 'warn' : 'done')
      const states = {
        read: running ? (unitsDone >= t.units ? 'done' : 'active') : 'done',
        schema: st(false, S && (S.schema.inferred > 0 || run.model?.phases?.schema?.review > 0)), domains: st(false, pend > 0), terms: st(false, run.model?.phases?.terms?.review > 0), build: st(false, false),
        gate: st(false, t.held > 0), deliver: running ? 'idle' : run.output ? 'done' : 'idle',
      }
      if (['failed', 'cancelled'].includes(run.status)) for (const k of Object.keys(states)) if (states[k] === 'done' && !run.output) states[k] = k === 'deliver' ? 'idle' : 'warn'
      const pc = (x) => (x == null ? '—' : `${(x * 100).toFixed(1)}%`)
      const MP = run.model?.phases
      const labels = {
        read: [`${fmt(unitsDone)} / ${fmt(t.units)} 目录`, `${fmt(t.patients)} 位病人`],
        schema: S ? [`${fmt(S.schema.tables)} 张表`, MP?.schema?.tables ? `模型起草 ${MP.schema.tables} · 分歧 ${MP.schema.review}` : S.schema.inferred ? `Basic ${S.schema.inferred} · 保留 ${S.schema.extrasFields} 字段` : `保留 ${S.schema.extrasFields} 字段`, S.schema.inferred || MP?.schema?.review ? 'warn' : ''] : ['—'],
        domains: S ? [`覆盖 ${pc(S.domains.coverage)}`, pend ? `待处理 ${fmt(pend)}` : '全部归一', pend ? 'warn' : ''] : ['—'],
        terms: S ? [`${fmt(S.terminology.mappedConcepts)} / ${fmt(S.terminology.concepts)} 概念`, MP?.terms?.asked ? `模型对照 ${fmt(MP.terms.confirmed)} · 分歧 ${fmt(MP.terms.review)}` : `覆盖 ${pc(S.terminology.coverage)}`] : ['—'],
        build: [`${fmt(t.resources)} 资源`],
        gate: [t.held ? `暂扣 ${t.held}` : `${fmt(t.done)} 通过`, t.errors ? `结构错误 ${t.errors}` : '', t.held ? 'warn' : ''],
        deliver: [run.output ? '已交付' : running ? '处理中' : '未交付', run.outputFormat === 'bundles' ? '按人' : run.outputFormat === 'ndjson' ? '按资源' : '按人 + 按资源'],
      }
      if (running && run.current?.unit === '模型') {
        const step = run.current.step ?? ''
        const at = step.startsWith('①') ? 'schema' : step.startsWith('② ③') ? 'domains' : step.startsWith('②') ? 'domains' : step.startsWith('③') ? 'terms' : 'schema'
        const order = ['read', 'schema', 'domains', 'terms', 'build', 'gate', 'deliver']
        for (const k of order) states[k] = order.indexOf(k) < order.indexOf(at) ? 'done' : k === at ? 'active' : 'idle'
        labels[at] = [step.replace(/^[①②③ ]+/, '').slice(0, 18), labels[at]?.[1] ?? '']
      }
      const done = run.patients.filter((p) => p.status !== 'held').length
      const held = run.patients.filter((p) => p.status === 'held').length
      const piles = fin ? { deliver: { n: run.output ? done : 0 }, gate: { n: held, warn: true } } : { build: { n: 1 }, deliver: { n: 0 }, read: { n: Math.max(0, t.units - unitsDone) } }
      const nav = { read: 'patients', schema: 'schema', domains: 'domains', terms: 'terms', build: 'resources', gate: 'patients', deliver: 'report' }
      const inferred = S?.schema.inferred ?? 0
      return {
        dark, states, labels, piles, belt: Math.min(26, t.patients * 3),
        bypass: { active: inferred > 0, label: inferred ? `旁路 · ${inferred} 张无规格的表 → Basic 原样保留` : '旁路 · 无规格的表 → Basic 原样保留' },
        loop: '复核对照 → 重跑（回到 ② ③）',
        onStation: (id) => onTab?.(nav[id]),
      }
    }

    function Overview({ run, openPatient, onTab, dark }) {
      const P = run.patients
      const t = run.totals
      const running = run.status === 'running'
      const S = run.stages
      const byType = {}
      for (const p of P) for (const [k, n] of Object.entries(p.byType ?? {})) byType[k] = (byType[k] ?? 0) + n
      const types = Object.entries(byType).sort((a, b) => b[1] - a[1])
      const max = Math.max(1, ...types.map(([, n]) => n))
      const pc = (x) => (x == null ? '—' : `${(x * 100).toFixed(1)}%`)
      // 待办：同类告警合并成一条
      const warns = [...new Set(run.warnings ?? [])]
      const lowCov = warns.filter((w) => w.startsWith('值域「'))
      const others = warns.filter((w) => !w.startsWith('值域「'))
      const pend = S ? S.domains.pending + S.domains.unmapped : 0
      const alerts = [
        run.error && { tone: 'b', title: '批次出错', sub: String(run.error).split('\n')[0], go: 'report', btn: '报告' },
        t.held && { tone: 'w', title: `暂扣 ${t.held} 位病人`, sub: '验收门未过，不在交付目录里', go: 'patients', btn: '病人' },
        pend && { tone: 'w', title: `值域待处理 ${fmt(pend)} 个取值`, sub: lowCov.length ? `${lowCov.length} 个值域覆盖率低于阈值（不阻断交付）` : '待确认或无对照，原值照常交付', go: 'domains', btn: '复核' },
        ...others.map((w) => ({ tone: 'w', title: w.length > 34 ? `${w.slice(0, 34)}…` : w, sub: w.length > 34 ? w : '', go: 'report', btn: '报告' })),
      ].filter(Boolean)
      const kv = (k, v, cls = '') => [h('span', { key: `${k}k`, className: 'hx-faint' }, k), h('span', { key: `${k}v`, className: `hx-num ${cls}`, title: typeof v === 'string' ? v : undefined }, v)]
      return h('div', { className: 'hx-ov' },
        h('div', { className: 'hx-ov-top' },
          h('div', { className: 'hx-frame hx-ov-stage' },
            h('div', { className: 'hx-ov-head' }, h('b', {}, '处理流程'), h('span', { className: 'hx-cap' }, 'PIPELINE'),
              h('span', { className: 'hx-legend' }, [['done', '已完成'], ['active', '处理中'], ['warn', '有待处理'], ['idle', '未开始']].map(([k2, l]) => h('span', { key: k2 }, h('i', { className: `hx-lg-${k2}` }), l)))),
            h('div', { className: 'hx-iso-wrap' }, h(IsoLine, isoProps(run, S, onTab, dark))),
            alerts.length ? h('div', { className: 'hx-alerts' },
              h('div', { className: 'hx-alerts-h' }, h('i', {}), h('b', {}, '待办'), h('span', { className: 'hx-cap' }, 'ALERTS'), h('span', { className: 'hx-sp' }), h('span', { className: 'hx-num hx-faint' }, alerts.length)),
              alerts.slice(0, 4).map((a, i) => h('div', { key: i, className: `hx-alert ${a.tone}`, title: a.sub || a.title },
                h('div', { style: { minWidth: 0 } }, h('div', { className: 'hx-alert-t' }, a.title), a.sub ? h('div', { className: 'hx-alert-s' }, a.sub) : null),
                h('button', { className: 'hx-btn sm', onClick: () => onTab(a.go) }, a.btn)))) : null,
            h('div', { className: 'hx-ov-foot hx-faint' }, '点工位进入对应页面 · 传送带上每个方块一位病人')),
          h('div', { className: 'hx-frame hx-pad hx-ov-side hx-scroll' },
            h('div', { className: 'hx-h' }, h('b', {}, '批次概览'), h('span', { className: 'hx-cap' }, 'OVERVIEW')),
            h('div', { className: 'hx-tiles' },
              [['病人', fmt(t.patients), ''], ['资源', fmt(t.resources), ''], ['暂扣', fmt(t.held), t.held ? 'hx-warn' : ''], ['结构错误', fmt(t.errors), t.errors ? 'hx-bad' : 'hx-ok']].map(([k, v, c]) => h('div', { key: k }, h('small', {}, k), h('b', { className: `hx-num ${c}` }, v)))),
            h('div', { className: 'hx-sec' }, h('b', {}, '三个阶段')),
            S ? h('div', { className: 'hx-stage-rows' },
              h('div', { onClick: () => onTab('schema') }, h('span', {}, '① Schema 同构'), h('span', { className: 'hx-num' }, `${S.schema.tables} 张表`), h('span', { className: 'hx-faint' }, `保留 ${S.schema.extrasFields} 字段`)),
              h('div', { onClick: () => onTab('domains') }, h('span', {}, '② 值域归一'), h(Coverage, { value: S.domains.coverage }), h('span', { className: pend ? 'hx-warn' : 'hx-faint' }, pend ? `待处理 ${fmt(pend)}` : '全部归一')),
              h('div', { onClick: () => onTab('terms') }, h('span', {}, '③ 术语对照'), h(Coverage, { value: S.terminology.coverage }), h('span', { className: 'hx-faint' }, `${fmt(S.terminology.mappedConcepts)}/${fmt(S.terminology.concepts)} 概念`))) : h('div', { className: 'hx-faint' }, running ? '处理中…' : '—'),
            h('div', { className: 'hx-sec' }, h('b', {}, '来源与交付')),
            h('div', { className: 'hx-kv hx-kv-tight' },
              ...kv('输入', run.input.split('/').slice(-2).join('/')),
              ...kv('来源', run.provenance?.kind === 'delivered' ? '匿名化正式交付' : run.provenance?.kind === 'withheld' ? '匿名化暂扣结果' : '未知来源', run.provenance?.kind === 'delivered' ? 'hx-ok' : 'hx-warn'),
              ...kv('源文件', run.sourceCheck ? (run.sourceCheck.changed ? `${run.sourceCheck.changed} 个变化` : `${fmt(run.sourceCheck.files)} 个，只读一致`) : '—', run.sourceCheck?.changed ? 'hx-warn' : 'hx-ok'),
              ...kv('交付', run.output ? run.output.split('/').slice(-2).join('/') : running ? '处理中' : '未交付'),
              ...kv('格式', { both: '按人 + 按资源', bundles: '按人', ndjson: '按资源' }[run.outputFormat ?? 'both']),
              ...kv('定义', run.definitions ? `${run.definitions.StructureDefinition} 扩展 · ${run.definitions.CodeSystem} 代码体系 · ${run.definitions.ConceptMap ?? 0} 对照` : '—'),
              ...kv('对照表', run.vocab?.version ?? '—')))),
        h('div', { className: 'hx-ov-bottom' },
          h('div', { className: 'hx-frame hx-pad' },
            h('div', { className: 'hx-h' }, h('b', {}, '病人'), h('span', { className: 'hx-cap' }, 'PATIENTS'), h('span', { className: 'hx-sp' }), h('span', { className: 'hx-faint' }, '每格 1 位，点开浏览资源')),
            h('div', { className: 'hx-cells' }, P.map((p) => h('i', { key: p.name, title: `${p.name}：${p.status === 'held' ? '暂扣' : '交付'}，资源 ${p.resources}`, className: p.status === 'held' ? 'w' : 'o', onClick: () => openPatient(p.name) })),
              running ? Array.from({ length: Math.max(0, t.units - (run.units?.length ?? 0)) }, (_, i) => h('i', { key: `p${i}`, className: i === 0 ? 'r' : '' })) : null),
            h('div', { className: 'hx-faint', style: { fontSize: 11.5, marginTop: 8 } }, `交付 ${fmt(t.done)} · 暂扣 ${fmt(t.held)} · 登记缺失的就诊 ${fmt(t.unresolvedEncounters)}`)),
          h('div', { className: 'hx-frame hx-pad', style: { flex: 2 } },
            h('div', { className: 'hx-h' }, h('b', {}, '资源类型'), h('span', { className: 'hx-cap' }, 'FHIR RESOURCES'), h('span', { className: 'hx-sp' }), h('span', { className: 'hx-faint' }, `${types.length} 类 · ${fmt(t.resources)} 个`)),
            types.length ? h('div', { className: 'hx-bars2' }, types.map(([k, n]) => h('div', { key: k, title: `${k} ${TYPE_ZH[k] ?? ''}` },
              h('span', {}, TYPE_ZH[k] ?? k), h('div', { className: 'track' }, h('span', { style: { width: `${Math.max(2, (n / max) * 100)}%` } })), h('span', { className: 'hx-num hx-muted' }, fmt(n))))) : h('div', { className: 'hx-faint' }, running ? '转换中…' : '—'))))
    }

    /* --------------------------------------------------------------- patients */
    function Patients({ run, patient, setPatient, openPatient }) {
      const d = useAsync(() => (patient ? call('patient', { runId: run.id, patient }) : null), [run.id, patient, run.status])
      const p = d.value?.patient
      return h('div', { style: { display: 'flex', gap: 8, flex: 1, minHeight: 0 } },
        h('div', { className: 'hx-frame hx-scroll', style: { flex: 1.3 } },
          h('table', {},
            h('thead', {}, h('tr', {}, ['病人', '状态', '源记录', '资源', '结构错误', '残留标识符', '登记缺失就诊', '耗时'].map((x) => h('th', { key: x }, x)))),
            h('tbody', {}, run.patients.map((x) => h('tr', { key: x.name, className: `click${x.name === patient ? ' sel' : ''}`, onClick: () => setPatient(x.name) },
              h('td', { className: 'hx-num' }, x.name),
              h('td', {}, x.status === 'held' ? h('span', { className: 'hx-chip w' }, '暂扣') : h('span', { className: 'hx-chip ok' }, '交付')),
              h('td', { className: 'hx-num' }, fmt(x.records)), h('td', { className: 'hx-num' }, fmt(x.resources)),
              h('td', { className: `hx-num ${x.gates?.structure?.errors ? 'hx-bad' : 'hx-faint'}` }, fmt(x.gates?.structure?.errors)),
              h('td', { className: `hx-num ${x.gates?.residual?.hits ? 'hx-bad' : 'hx-faint'}` }, fmt(x.gates?.residual?.hits)),
              h('td', { className: 'hx-num hx-faint' }, fmt(x.unresolvedEncounters)),
              h('td', { className: 'hx-num hx-faint' }, fmtMs(x.ms))))))),
        h('div', { className: 'hx-frame hx-scroll hx-pad', style: { flex: 1 } },
          !patient ? h('div', { className: 'hx-faint' }, '选择一位病人') : !p ? h('div', { className: 'hx-faint' }, d.error ?? '加载中…') : h(React.Fragment, {},
            h('div', { className: 'hx-h' }, h('b', { className: 'hx-num' }, p.name), p.status === 'held' ? h('span', { className: 'hx-chip w' }, '验收门未过，暂扣') : h('span', { className: 'hx-chip ok' }, '已交付'), h('span', { className: 'hx-sp' }), h('button', { className: 'hx-btn sm', onClick: () => openPatient(p.name) }, '浏览资源 →')),
            h('div', { className: 'hx-kv' },
              h('span', { className: 'hx-faint' }, '所在目录'), h('span', {}, p.unit),
              h('span', { className: 'hx-faint' }, '病人编号'), h('span', { className: 'hx-num' }, p.key),
              h('span', { className: 'hx-faint' }, 'Bundle'), h('span', { className: 'hx-num', style: { wordBreak: 'break-all' } }, d.value.bundle ?? '—')),
            h('div', { className: 'hx-sec' }, h('b', {}, '资源'), h('span', { className: 'hx-cap' }, 'RESOURCES')),
            h('div', {}, Object.entries(p.byType ?? {}).sort((a, b) => byOrder(a[0], b[0])).map(([k, n]) => h('span', { key: k, className: 'hx-chip' }, `${k} ${fmt(n)}`))),
            h('div', { className: 'hx-sec' }, h('b', {}, '验收门'), h('span', { className: 'hx-cap' }, 'GATES')),
            h('table', {}, h('tbody', {},
              h('tr', {}, h('td', {}, '结构与引用完整性'), h('td', { className: p.gates.structure.pass ? 'hx-ok' : 'hx-bad' }, p.gates.structure.pass ? '通过' : `${p.gates.structure.errors} 个错误`)),
              h('tr', {}, h('td', {}, '残留身份证号 / 手机号'), h('td', { className: p.gates.residual.pass && !p.gates.residual.hits ? 'hx-ok' : 'hx-bad' }, p.gates.residual.hits ? `${p.gates.residual.hits} 处` : '无')),
              h('tr', {}, h('td', {}, '结构提示'), h('td', { className: 'hx-muted' }, fmt(p.validation?.warnings))))),
            (p.validation?.errors ?? []).length ? h(React.Fragment, {}, h('div', { className: 'hx-sec' }, h('b', {}, '结构错误')), p.validation.errors.map((e, i) => h('div', { key: i, className: 'hx-bad', style: { fontSize: 11.5, marginBottom: 3 } }, `${e.type}/${e.id.slice(0, 8)}… ${e.path}：${e.message}`))) : null,
            (p.residual ?? []).length ? h(React.Fragment, {}, h('div', { className: 'hx-sec' }, h('b', {}, '残留标识符'), h('span', { className: 'hx-faint' }, '只显示遮盖后的值')), p.residual.map((x, i) => h('div', { key: i, className: 'hx-bad', style: { fontSize: 11.5 } }, `${x.kind} ${x.value} · ${x.where}`))) : null,
            (p.issues ?? []).length ? h(React.Fragment, {}, h('div', { className: 'hx-sec' }, h('b', {}, '转换提示')), p.issues.map((x, i) => h('div', { key: i, className: 'hx-warn', style: { fontSize: 11.5 } }, x))) : null,
            h('div', { className: 'hx-sec' }, h('b', {}, '原样保留的字段'), h('span', { className: 'hx-faint' }, 'source-field 扩展')),
            Object.keys(p.leftoverFields ?? {}).length ? h('div', {}, Object.entries(p.leftoverFields).sort((a, b) => b[1] - a[1]).slice(0, 80).map(([k, n]) => h('span', { key: k, className: 'hx-chip', title: `${n} 处` }, `${k} · ${n}`))) : h('div', { className: 'hx-faint' }, '无'))))
    }

    /* -------------------------------------------------------------- resources */
    function Resources({ run, patient, setPatient }) {
      const [type, setType] = useState(null)
      const [sel, setSel] = useState(null)
      const [q, setQ] = useState('')
      const list = useAsync(() => (patient ? call('resources', { runId: run.id, patient, type }) : null), [run.id, patient, type, run.status])
      const detail = useAsync(() => (sel ? call('resource', { runId: run.id, patient, type: sel.type, id: sel.id }) : null), [sel?.type, sel?.id, patient])
      useEffect(() => { setSel(null) }, [patient, type])
      const v = list.value
      const rows = useMemo(() => {
        const all = v?.rows ?? []
        if (!q) return all
        const k = q.toLowerCase()
        return all.filter((r) => `${r.label} ${r.value ?? ''} ${r.date ?? ''}`.toLowerCase().includes(k))
      }, [v, q])
      return h('div', { style: { display: 'flex', gap: 8, flex: 1, minHeight: 0 } },
        h('div', { className: 'hx-frame hx-pad hx-scroll', style: { width: 210, flex: 'none' } },
          h('label', { className: 'hx-field' }, '病人', h('select', { className: 'hx-input', value: patient ?? '', onChange: (e) => { setPatient(e.target.value); setType(null) } }, run.patients.map((p) => h('option', { key: p.name, value: p.name }, `${p.name}${p.status === 'held' ? '（暂扣）' : ''}`)))),
          h('div', { className: 'hx-sec' }, h('b', {}, '资源类型')),
          v ? h('div', { className: 'hx-list' }, Object.entries(v.types).sort((a, b) => byOrder(a[0], b[0])).map(([k, n]) => h('div', { key: k, className: `hx-li${v.type === k ? ' on' : ''}`, onClick: () => setType(k) },
            h('span', {}, k, h('span', { className: 'hx-faint', style: { fontSize: 10.5 } }, ` ${TYPE_ZH[k] ?? ''}`)), h('span', { className: 'hx-num hx-muted' }, fmt(n))))) : h('div', { className: 'hx-faint' }, list.error ?? '加载中…')),
        h('div', { className: 'hx-frame hx-col', style: { flex: 1.2, minWidth: 0 } },
          h('div', { className: 'hx-pad', style: { display: 'flex', gap: 8, alignItems: 'center', paddingBottom: 6 } },
            h('b', {}, v ? `${v.type} · ${fmt(v.total)}` : '—'), v && v.total > v.rows.length ? h('span', { className: 'hx-faint' }, `（显示前 ${fmt(v.rows.length)} 条）`) : null,
            h('span', { className: 'hx-sp' }), h('input', { className: 'hx-input', placeholder: '筛选…', value: q, onChange: (e) => setQ(e.target.value), style: { width: 160 } })),
          h('div', { className: 'hx-scroll', style: { flex: 1 } },
            h('table', {},
              h('thead', {}, h('tr', {}, ['名称', '时间', '值', ''].map((x, i) => h('th', { key: i }, x)))),
              h('tbody', {}, rows.slice(0, 1000).map((r) => h('tr', { key: r.id, className: `click${sel?.id === r.id ? ' sel' : ''}`, onClick: () => setSel(r) },
                h('td', {}, r.label, r.status === 'entered-in-error' ? h('span', { className: 'hx-chip b', style: { marginLeft: 6 } }, '作废') : null, r.tag === 'encounter-not-registered' ? h('span', { className: 'hx-chip w', style: { marginLeft: 6 } }, '登记缺失') : null),
                h('td', { className: 'hx-num hx-faint', style: { whiteSpace: 'nowrap' } }, shortTime(r.date)),
                h('td', { className: 'hx-num' }, r.value ?? ''),
                h('td', {}, r.extra ? h('span', { className: 'hx-chip', title: '原样保留的源字段' }, `+${r.extra}`) : null))))))),
        h('div', { className: 'hx-frame hx-pad hx-scroll', style: { flex: 1.3, minWidth: 0 } },
          !sel ? h('div', { className: 'hx-faint' }, '点左边一条资源，查看完整的 FHIR JSON') : !detail.value ? h('div', { className: 'hx-faint' }, detail.error ?? '加载中…') : h(React.Fragment, {},
            h('div', { className: 'hx-h' }, h('b', {}, `${sel.type}/`), h('span', { className: 'hx-num hx-muted' }, sel.id)),
            detail.value.texts.length ? h(React.Fragment, {}, h('div', { className: 'hx-cap', style: { marginBottom: 6 } }, '附件正文（解码后）'), detail.value.texts.map((x, i) => h('div', { key: i, className: 'hx-text' }, x.text || '（空）'))) : null,
            h(Json, { value: detail.value.resource }))))
    }

    /* ------------------------------------------------------- ① Schema 同构 */
    const DRAFT_ST = { applied: ['模型起草 · 未复核', 't'], review: ['模型起草 · 有未解决问题', 'w'], confirmed: ['人工已确认', 'ok'], rejected: ['已驳回 · 按 Basic', 'b'], failed: ['起草失败', 'b'] }
    const draftLabel = (dr) => (dr.status === 'applied' ? (dr.agreement === 'disputed' ? ['模型起草 · 复判为准', 'vio'] : ['模型起草 · 两模型一致', 't']) : DRAFT_ST[dr.status] ?? [dr.status, ''])
    function SchemaTab({ run, onRerun }) {
      const [tick, setTick] = useState(0)
      const d = useAsync(() => call('schema', { runId: run.id }), [run.id, run.status, tick])
      const [sel, setSel] = useState(null)
      const [json, setJson] = useState(null)
      const [err, setErr] = useState('')
      const [changed, setChanged] = useState(0)
      const act = async (file, action, spec) => { setErr(''); try { await call('reviewDraft', { file, action, spec }); setJson(null); setChanged((n) => n + 1); setTick((n) => n + 1) } catch (e) { setErr(msg(e)) } }
      if (!d.value) return h('div', { className: 'hx-frame hx-pad', style: { flex: 1 } }, h('span', { className: 'hx-faint' }, d.error ?? '加载中…'))
      const tables = d.value.tables
      const t = tables.find((x) => x.table === sel) ?? tables[0]
      const dr = t?.draft
      return h('div', { className: 'hx-col', style: { flex: 1 } },
        h(RerunBar, { run, changed, onRerun }),
        h('div', { style: { display: 'flex', gap: 8, flex: 1, minHeight: 0 } },
        h('div', { className: 'hx-frame hx-scroll', style: { width: 400, flex: 'none' } },
          h('div', { className: 'hx-pad', style: { paddingBottom: 4 } }, h('div', { className: 'hx-h' }, h('b', {}, '① Schema 同构'), h('span', { className: 'hx-cap' }, 'HARMONIZE')),
            h('div', { className: 'hx-muted', style: { fontSize: 11.5, lineHeight: 1.6 } }, '表 → 记录类别，字段 → 语义角色。只搬不改：这一步不解释任何取值。没有规格的表由模型起草（插件校验 + 独立盲审 + 复判），没对上的字段原样保留。'),
            d.value.model?.tables ? h('div', { className: 'hx-muted', style: { fontSize: 11.5, marginTop: 6 } }, `本批模型起草 ${d.value.model.tables} 张：一致采用 ${d.value.model.applied}、有分歧 ${d.value.model.review}、失败 ${d.value.model.failed}`) : null),
          h('table', {}, h('thead', {}, h('tr', {}, ['表', '类别', '行数', '保留字段'].map((x) => h('th', { key: x }, x)))),
            h('tbody', {}, tables.map((x) => h('tr', { key: x.table, className: `click${x === t ? ' sel' : ''}`, onClick: () => setSel(x.table) },
              h('td', { className: 'hx-num' }, x.table, x.inferred ? h('span', { className: 'hx-chip w', style: { marginLeft: 6 } }, '自动推断 · Basic') : x.draft ? h('span', { className: `hx-chip ${draftLabel(x.draft)[1]}`, style: { marginLeft: 6 } }, draftLabel(x.draft)[0]) : null),
              h('td', {}, h('span', { className: 'hx-chip t' }, x.kind)), h('td', { className: 'hx-num' }, fmt(x.rows)), h('td', { className: 'hx-num hx-faint' }, fmt(x.extras.length))))))),
        !t ? h('div', { className: 'hx-frame hx-pad', style: { flex: 1 } }, '—') : h('div', { className: 'hx-frame hx-scroll hx-pad', style: { flex: 1 } },
          h('div', { className: 'hx-h' }, h('b', { className: 'hx-num' }, t.table), h('span', { className: 'hx-chip t' }, t.kind), h('span', { className: 'hx-faint' }, `${t.profile === 'auto' ? '自动推断' : `规格 ${t.profile}`} · ${t.file ?? ''} · ${fmt(t.rows)} 行${t.invalid ? ` · 作废 ${t.invalid}` : ''}`)),
          t.inferred ? h('div', { className: 'hx-text', style: { fontSize: 12 } }, `没有现成规格，按 Basic 保留全部字段（${run.model?.configured ? '模型起草失败或已驳回' : '未配置模型'}）。建议类别：${t.suggestedKind ?? '—'}。推断依据：\n${t.reasons.join('\n') || '—'}`) : null,
          dr ? h('div', { className: 'hx-draft' },
            h('div', { style: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' } },
              h('span', { className: `hx-chip ${draftLabel(dr)[1]}` }, draftLabel(dr)[0]),
              h('span', { className: 'hx-faint', style: { fontSize: 11.5 } }, `${dr.models?.suggest ?? ''}${dr.models?.verify ? ` · 盲审 ${dr.models.verify}` : ''} · ${dr.rounds ?? 0} 轮`),
              h('span', { className: 'hx-sp' }),
              dr.status !== 'confirmed' ? h('button', { className: 'hx-btn sm pri', onClick: () => act(dr.file, 'confirm') }, '确认') : null,
              h('button', { className: 'hx-btn sm', onClick: () => setJson(json === null ? JSON.stringify(dr.spec, null, 2) : null) }, json === null ? '修改' : '收起'),
              h('button', { className: 'hx-btn sm', onClick: () => act(dr.file, 'redraft') }, '重新起草'),
              dr.status !== 'rejected' ? h('button', { className: 'hx-btn sm', onClick: () => act(dr.file, 'reject') }, '驳回（按 Basic）') : null),
            dr.disputed?.length ? h('div', { className: 'hx-warn', style: { fontSize: 12, marginTop: 6 } }, `两模型有分歧、已先拿掉的字段（原样保留）：${dr.disputed.join('、')}`) : null,
            dr.dropped?.length ? h('div', { className: 'hx-faint', style: { fontSize: 12, marginTop: 4 } }, `插件校验后去掉的角色：${dr.dropped.join('、')}`) : null,
            dr.links?.length ? h('div', { style: { fontSize: 12, marginTop: 4 } }, h('span', { className: 'hx-faint' }, '就诊号关联（按数据核对，覆盖了模型的选择）：'), dr.links.map((x, i) => h('div', { key: i, className: 'hx-num', style: { marginTop: 2 } }, `${x.role}：${x.previous ?? '—'} → ${x.field ?? '（拿掉）'}`, h('span', { className: 'hx-faint' }, `　${x.evidence}`)))) : null,
            dr.issue?.reason ? h('div', { className: 'hx-warn', style: { fontSize: 12, marginTop: 4 } }, `未解决的问题：${dr.issue.reason}`) : null,
            dr.dismissed?.length ? h('div', { style: { fontSize: 12, marginTop: 4 } }, h('span', { className: 'hx-faint' }, '核验模型提出、复判未采纳（请人工过目）：'), dr.dismissed.map((x, i) => h('div', { key: i, style: { marginTop: 2 } }, h('span', { className: 'hx-warn' }, `R${x.round} ${x.reason}`), h('span', { className: 'hx-faint' }, ` ← 复判：${x.ruling}`)))) : null,
            h('details', { style: { marginTop: 6 } }, h('summary', { className: 'hx-faint', style: { fontSize: 12, cursor: 'pointer' } }, '起草过程'),
              (dr.trail ?? []).map((x, i) => h('div', { key: i, style: { fontSize: 11.5, marginTop: 3 } }, h('span', { className: 'hx-num hx-faint' }, `R${x.round} ${x.step}`), ' ', x.ok === true ? h('span', { className: 'hx-ok' }, '通过 ') : x.ok === false ? h('span', { className: 'hx-warn' }, '报出问题 ') : x.revise === true ? h('span', { className: 'hx-ok' }, '改正 ') : x.revise === false ? h('span', { className: 'hx-warn' }, '坚持 ') : null, x.reason ?? ''))),
            json !== null ? h('div', { style: { marginTop: 8 } }, h('textarea', { className: 'hx-input hx-num', style: { width: '100%', height: 260, fontSize: 11.5 }, value: json, onChange: (e) => setJson(e.target.value) }),
              h('div', { style: { display: 'flex', gap: 8, marginTop: 6 } }, h('button', { className: 'hx-btn pri', onClick: () => act(dr.file, 'edit', json) }, '保存并确认'), h('span', { className: 'hx-faint', style: { fontSize: 11.5 } }, '规格格式见 lib/mapping/roles.js；保存后下次运行生效'))) : null,
            err ? h('div', { className: 'hx-err', style: { marginTop: 6 } }, err) : null) : null,
          h('div', { className: 'hx-sec' }, h('b', {}, '角色'), h('span', { className: 'hx-faint' }, '字段 → 语义角色；多个字段时取第一个有值的')),
          h('table', {}, h('thead', {}, h('tr', {}, ['角色', '来源字段', '有值', '填充率', '值域'].map((x) => h('th', { key: x }, x)))),
            h('tbody', {}, t.roles.map((r) => h('tr', { key: r.role },
              h('td', { className: 'hx-num' }, r.role), h('td', { className: 'hx-num hx-muted' }, r.fields.join(' → ')),
              h('td', { className: 'hx-num' }, fmt(r.filled)),
              h('td', {}, h('div', { className: 'hx-bars', style: { gridTemplateColumns: '1fr auto' } }, h('div', { className: 'track' }, h('span', { style: { width: `${t.rows ? (r.filled / t.rows) * 100 : 0}%` } })), h('span', { className: 'hx-num hx-faint' }, `${t.rows ? Math.round((r.filled / t.rows) * 100) : 0}%`))),
              h('td', { className: 'hx-num hx-faint' }, r.domain ?? ''))))),
          h('div', { className: 'hx-sec' }, h('b', {}, '原样保留的字段'), h('span', { className: 'hx-faint' }, 'source-field 扩展；出现多的值得补进规格')),
          t.extras.length ? h('div', {}, t.extras.map(([f, n]) => h('span', { key: f, className: 'hx-chip' }, `${f} · ${fmt(n)}`))) : h('div', { className: 'hx-faint' }, '无'),
          t.fields ? h(React.Fragment, {}, h('div', { className: 'hx-sec' }, h('b', {}, '字段画像')), h('div', {}, t.fields.map((f) => h('span', { key: f.name, className: `hx-chip${f.pseudonym ? ' w' : f.time ? ' t' : ''}`, title: `填充 ${f.fill}%${f.pseudonym ? ` · ${f.pseudonym}假名` : ''}${f.time ? ' · 时间' : ''}` }, f.name)))) : null)))
    }

    /* ---------------------------------------------------------- ② 值域归一 */
    const DST = { normalized: ['已归一', 'ok'], text: ['原文保留', 't'], pending: ['待确认', 'w'], unmapped: ['无对照', 'w'], invalid: ['不属于本值域', 'b'] }
    const ENTRY_ST = { confirmed: '已确认', pending: '待确认', invalid: '不属于本值域', text: '按原文保留' }
    const dchip = (s) => h('span', { className: `hx-chip ${DST[s]?.[1] ?? ''}` }, DST[s]?.[0] ?? s)
    function Coverage({ value }) {
      const p = value == null ? null : Math.round(value * 1000) / 10
      return h('div', { className: 'hx-bars', style: { gridTemplateColumns: '1fr auto' } }, h('div', { className: 'track' }, h('span', { style: { width: `${p ?? 0}%`, background: p == null ? 'var(--line2)' : p >= 90 ? 'var(--ok)' : p >= 60 ? 'var(--warn)' : 'var(--bad)' } })), h('span', { className: 'hx-num hx-faint' }, p == null ? '—' : `${p}%`))
    }
    function RerunBar({ run, changed, onRerun }) {
      if (!changed) return null
      return h('div', { className: 'hx-frame hx-pad', style: { display: 'flex', gap: 10, alignItems: 'center', borderColor: 'var(--warn)' } },
        h('span', { className: 'hx-warn' }, `已复核 ${changed} 处，与本批结果不同；对照已存本机，下次运行生效。`), h('span', { className: 'hx-sp' }),
        h('button', { className: 'hx-btn pri', disabled: run.status === 'running', onClick: onRerun }, '用新对照重跑本批'))
    }
    function DomainsTab({ run, onRerun }) {
      const [tick, setTick] = useState(0)
      const d = useAsync(() => call('domains', { runId: run.id }), [run.id, run.status, tick])
      const [sel, setSel] = useState(null)
      const [filter, setFilter] = useState('open')
      const [edit, setEdit] = useState(null)
      const [err, setErr] = useState('')
      if (!d.value) return h('div', { className: 'hx-frame hx-pad', style: { flex: 1 } }, h('span', { className: 'hx-faint' }, d.error ?? '加载中…'))
      const doms = d.value.domains
      const dom = doms.find((x) => x.id === sel) ?? doms.find((x) => x.kind === 'enum') ?? doms[0]
      const changed = doms.reduce((n, x) => n + x.changed, 0)
      const open = (v) => ['pending', 'unmapped', 'invalid'].includes(v.status) || v.changed
      const rows = (dom?.values ?? []).filter((v) => filter === 'all' || (filter === 'open' ? open(v) : filter === 'model' ? v.current?.source === 'model' : v.status === filter))
      const confirm = async (v) => { setErr(''); try { await call('confirmModel', { kind: 'domain', id: dom.id, key: `${v.code ?? ''}\u0001${v.display ?? ''}` }); setTick((x) => x + 1) } catch (e) { setErr(msg(e)) } }
      const save = async () => {
        setErr('')
        try { await call('reviewDomain', { domain: dom.id, code: edit.code, display: edit.display, to: edit.status === 'confirmed' ? edit.to : null, status: edit.status, note: edit.note }); setEdit(null); setTick((x) => x + 1) } catch (e) { setErr(msg(e)) }
      }
      const startEdit = (v) => setEdit({ key: `${v.code ?? ''}|${v.display ?? ''}`, code: v.code ?? undefined, display: v.display ?? undefined, to: v.current?.to ?? v.to ?? (dom.target?.values?.[0]?.code ?? ''), status: v.current?.status ?? 'confirmed', note: v.current?.note ?? '' })
      return h('div', { className: 'hx-col', style: { flex: 1 } },
        h(RerunBar, { run, changed, onRerun }),
        h('div', { style: { display: 'flex', gap: 8, flex: 1, minHeight: 0 } },
          h('div', { className: 'hx-frame hx-scroll', style: { width: 360, flex: 'none' } },
            h('div', { className: 'hx-pad', style: { paddingBottom: 4 } }, h('div', { className: 'hx-h' }, h('b', {}, '② 值域归一'), h('span', { className: 'hx-cap' }, 'NORMALIZE')),
              h('div', { className: 'hx-muted', style: { fontSize: 11.5, lineHeight: 1.6 } }, '同一件事写法不统一 → 规范值。原值始终保留；含义未确认的标“待确认”，不猜。'),
              d.value.summary ? h('div', { className: 'hx-muted', style: { fontSize: 11.5, marginTop: 6 } }, `覆盖率 ${(d.value.summary.coverage * 100).toFixed(1)}% · 待确认 ${fmt(d.value.summary.pending)} · 无对照 ${fmt(d.value.summary.unmapped)} · 不属于/无法解析 ${fmt(d.value.summary.invalid)}`) : null),
            h('table', {}, h('thead', {}, h('tr', {}, ['值域', '取值', '覆盖率', ''].map((x, i) => h('th', { key: i }, x)))),
              h('tbody', {}, doms.map((x) => h('tr', { key: x.id, className: `click${x === dom ? ' sel' : ''}`, onClick: () => { setSel(x.id); setEdit(null) } },
                h('td', {}, x.name, h('div', { className: 'hx-faint hx-num', style: { fontSize: 10 } }, x.kind === 'enum' ? '对照' : '格式')),
                h('td', { className: 'hx-num' }, fmt(x.total)), h('td', { style: { width: 110 } }, h(Coverage, { value: x.coverage })),
                h('td', {}, (x.byStatus.pending ?? 0) + (x.byStatus.unmapped ?? 0) ? h('span', { className: 'hx-chip w' }, fmt((x.byStatus.pending ?? 0) + (x.byStatus.unmapped ?? 0))) : null, x.changed ? h('span', { className: 'hx-chip t' }, `改 ${x.changed}`) : null)))))),
          !dom ? null : h('div', { className: 'hx-frame hx-col', style: { flex: 1, minWidth: 0 } },
            h('div', { className: 'hx-pad', style: { paddingBottom: 6 } },
              h('div', { className: 'hx-h' }, h('b', {}, dom.name), h('span', { className: 'hx-faint hx-num' }, dom.id), dom.version ? h('span', { className: 'hx-chip' }, `v${dom.version}`) : null, dom.reviewed ? h('span', { className: 'hx-chip t' }, `本机复核 ${dom.reviewed}`) : null),
              h('div', { className: 'hx-muted', style: { fontSize: 12, lineHeight: 1.6 } }, dom.description),
              dom.target ? h('div', { className: 'hx-faint', style: { fontSize: 11.5, marginTop: 4 } }, `目标：${dom.target.name}（${dom.target.system}）`) : null,
              h('div', { style: { display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' } },
                Object.entries(dom.byStatus).map(([k, n]) => h('span', { key: k }, dchip(k), h('span', { className: 'hx-num hx-muted' }, fmt(n)))),
                h('span', { className: 'hx-sp' }),
                dom.kind === 'enum' ? h('select', { className: 'hx-input', value: filter, onChange: (e) => setFilter(e.target.value) }, h('option', { value: 'open' }, '待处理（待确认/无对照/不属于/已改）'), h('option', { value: 'model' }, '模型给出 · 未经人工复核'), h('option', { value: 'all' }, '全部'), ...Object.keys(DST).map((k) => h('option', { key: k, value: k }, DST[k][0]))) : null),
              dom.kind === 'format' ? h('div', { style: { marginTop: 10 } }, h('div', { className: 'hx-cap', style: { marginBottom: 4 } }, '写法分布'), h('div', {}, Object.entries(dom.forms ?? {}).sort((a, b) => b[1] - a[1]).map(([f, n]) => h('span', { key: f, className: 'hx-chip' }, `${f} · ${fmt(n)}`)))) : null,
              err ? h('div', { className: 'hx-err', style: { marginTop: 6 } }, err) : null),
            h('div', { className: 'hx-scroll', style: { flex: 1 } },
              h('table', {}, h('thead', {}, h('tr', {}, ['代码', '名称 / 原值', '次数', '本批', '对照', '说明', ''].map((x, i) => h('th', { key: i }, x)))),
                h('tbody', {}, (dom.kind === 'format' ? dom.values : rows).slice(0, 500).flatMap((v) => {
                  const k = `${v.code ?? ''}|${v.display ?? ''}`
                  const cur = v.current
                  const tv = (code) => dom.target?.values?.find((x) => x.code === code)
                  const row = h('tr', { key: k, className: edit?.key === k ? 'sel' : '' },
                    h('td', { className: 'hx-num' }, v.code ?? ''), h('td', {}, v.display ?? ''), h('td', { className: 'hx-num' }, fmt(v.count)),
                    h('td', {}, dchip(v.status)),
                    h('td', {}, cur ? h(React.Fragment, {}, h('span', { className: `hx-chip ${cur.status === 'confirmed' ? 'ok' : cur.status === 'invalid' ? 'b' : cur.status === 'text' ? 't' : 'w'}` }, ENTRY_ST[cur.status]), cur.to ? h('span', { className: 'hx-num' }, `→ ${cur.to}${tv(cur.to)?.label ? ` ${tv(cur.to).label}` : ''}`) : null, cur.source === 'review' ? h('span', { className: 'hx-chip t', style: { marginLeft: 4 } }, '本机复核') : null, cur.source === 'model' ? h('span', { className: 'hx-chip vio', style: { marginLeft: 4 }, title: (cur.trail ?? []).map((x) => `R${x.round} ${x.step}${x.ok === false ? ' 报出问题' : x.ok ? ' 通过' : ''}${x.revise === true ? ' 改正' : x.revise === false ? ' 坚持' : ''} ${x.reason ?? ''}`).join('\n') }, '模型 · 未复核') : null, cur.candidate ? h('span', { className: 'hx-num hx-faint', style: { marginLeft: 4 } }, `候选 ${cur.candidate.verdict}${cur.candidate.to ? ` → ${cur.candidate.to}` : ''}`) : null, v.changed ? h('span', { className: 'hx-chip w', style: { marginLeft: 4 } }, '下次生效') : null) : h('span', { className: 'hx-faint' }, '—')),
                    h('td', { className: 'hx-faint', style: { fontSize: 11.5, maxWidth: 280 } }, cur?.note ?? v.note ?? ''),
                    h('td', { style: { whiteSpace: 'nowrap' } }, cur?.source === 'model' && cur.status === 'confirmed' ? h('button', { className: 'hx-btn sm pri', style: { marginRight: 4 }, onClick: () => confirm(v) }, '确认') : null, dom.kind === 'enum' ? h('button', { className: 'hx-btn sm', onClick: () => (edit?.key === k ? setEdit(null) : startEdit(v)) }, edit?.key === k ? '收起' : '复核') : null))
                  if (edit?.key !== k) return [row]
                  const vals = dom.target?.values ?? []
                  return [row, h('tr', { key: `${k}-e` }, h('td', { colSpan: 7 },
                    h('div', { style: { display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', padding: '4px 0 8px' } },
                      h('label', { className: 'hx-field' }, '结论', h('select', { className: 'hx-input', value: edit.status, onChange: (e) => setEdit({ ...edit, status: e.target.value }) }, Object.entries(ENTRY_ST).map(([s2, l]) => h('option', { key: s2, value: s2 }, l)))),
                      edit.status === 'confirmed' ? h('label', { className: 'hx-field' }, `规范值（${dom.target?.name ?? ''}）`,
                        vals.length && !dom.target?.open ? h('select', { className: 'hx-input', value: edit.to, onChange: (e) => setEdit({ ...edit, to: e.target.value }) }, vals.map((x) => h('option', { key: x.code, value: x.code }, `${x.code} · ${x.label ?? x.display}`)))
                          : h('input', { className: 'hx-input', value: edit.to ?? '', placeholder: '规范代码', onChange: (e) => setEdit({ ...edit, to: e.target.value }) })) : null,
                      h('label', { className: 'hx-field', style: { flex: 1, minWidth: 200 } }, '依据 / 说明', h('input', { className: 'hx-input', value: edit.note ?? '', onChange: (e) => setEdit({ ...edit, note: e.target.value }) })),
                      h('button', { className: 'hx-btn pri', onClick: save }, '保存'))))]
                })))))))
    }

    /* ---------------------------------------------------------- ③ 术语对照 */
    const EQ = { equivalent: '等价', wider: '目标更宽', narrower: '目标更窄', inexact: '近似', unmatched: '无对应' }
    function TermsTab({ run, onRerun }) {
      const [tick, setTick] = useState(0)
      const d = useAsync(() => call('terminology', { runId: run.id }), [run.id, run.status, tick])
      const [sel, setSel] = useState(null)
      const [filter, setFilter] = useState('unmapped')
      const [q, setQ] = useState('')
      const [edit, setEdit] = useState(null)
      const [err, setErr] = useState('')
      if (!d.value) return h('div', { className: 'hx-frame hx-pad', style: { flex: 1 } }, h('span', { className: 'hx-faint' }, d.error ?? '加载中…'))
      const bs = d.value.bindings
      const b = bs.find((x) => x.id === sel) ?? bs[0]
      const changed = bs.reduce((n, x) => n + x.changed, 0)
      const mapped = (c) => c.current?.status === 'confirmed' && (c.current.to || c.current.equivalence === 'unmatched')
      const rows = (b?.items ?? []).filter((c) => (filter === 'all' || (filter === 'model' ? c.current?.source === 'model' && mapped(c) : filter === 'candidates' ? Boolean(c.current?.candidates?.length) : filter === 'mapped' ? mapped(c) : !mapped(c))) && (!q || `${c.code ?? ''} ${c.display ?? ''}`.toLowerCase().includes(q.toLowerCase())))
      const confirm = async (c) => { setErr(''); try { await call('confirmModel', { kind: 'term', id: b.id, key: c.key }); setTick((x) => x + 1) } catch (e) { setErr(msg(e)) } }
      const save = async () => {
        setErr('')
        try { await call('reviewTerm', { binding: b.id, key: edit.key, from: edit.from, to: edit.equivalence === 'unmatched' ? null : { code: edit.code, display: edit.display }, equivalence: edit.equivalence, status: edit.status, note: edit.note }); setEdit(null); setTick((x) => x + 1) } catch (e) { setErr(msg(e)) }
      }
      return h('div', { className: 'hx-col', style: { flex: 1 } },
        h(RerunBar, { run, changed, onRerun }),
        h('div', { style: { display: 'flex', gap: 8, flex: 1, minHeight: 0 } },
          h('div', { className: 'hx-frame hx-scroll', style: { width: 360, flex: 'none' } },
            h('div', { className: 'hx-pad', style: { paddingBottom: 4 } }, h('div', { className: 'hx-h' }, h('b', {}, '③ 术语对照'), h('span', { className: 'hx-cap' }, 'TERMINOLOGY')),
              h('div', { className: 'hx-muted', style: { fontSize: 11.5, lineHeight: 1.6 } }, '本地概念 → 外部标准术语（LOINC、SNOMED CT、国家标准代码表）。不改原值，已确认的对照另加一个标准编码；没对照的照常交付。')),
            h('table', {}, h('thead', {}, h('tr', {}, ['对照', '概念', '覆盖（按次数）'].map((x) => h('th', { key: x }, x)))),
              h('tbody', {}, bs.map((x) => h('tr', { key: x.id, className: `click${x === b ? ' sel' : ''}`, onClick: () => { setSel(x.id); setEdit(null) } },
                h('td', {}, x.name, x.changed ? h('span', { className: 'hx-chip t', style: { marginLeft: 4 } }, `改 ${x.changed}`) : null),
                h('td', { className: 'hx-num' }, `${fmt(x.mappedConcepts)}/${fmt(x.conceptCount)}`), h('td', { style: { width: 110 } }, h(Coverage, { value: x.coverage }))))))),
          !b ? null : h('div', { className: 'hx-frame hx-col', style: { flex: 1, minWidth: 0 } },
            h('div', { className: 'hx-pad', style: { paddingBottom: 6 } },
              h('div', { className: 'hx-h' }, h('b', {}, b.name), b.version ? h('span', { className: 'hx-chip' }, `v${b.version}`) : null, b.reviewed ? h('span', { className: 'hx-chip t' }, `本机复核 ${b.reviewed}`) : null),
              h('div', { className: 'hx-muted', style: { fontSize: 12, lineHeight: 1.6 } }, b.description),
              h('div', { className: 'hx-faint', style: { fontSize: 11.5, marginTop: 4 } }, `目标：${b.target?.name ?? ''}（${b.target?.system ?? ''}）· 落在 ${b.lands ?? ''}`),
              h('div', { style: { display: 'flex', gap: 6, marginTop: 8, alignItems: 'center' } },
                h('select', { className: 'hx-input', value: filter, onChange: (e) => setFilter(e.target.value) }, h('option', { value: 'unmapped' }, '未对照'), h('option', { value: 'mapped' }, '已对照'), h('option', { value: 'model' }, '模型给出 · 未经人工复核'), h('option', { value: 'candidates' }, '两模型有分歧（有候选）'), h('option', { value: 'all' }, '全部')),
                h('input', { className: 'hx-input', placeholder: '筛选代码/名称…', value: q, onChange: (e) => setQ(e.target.value) }), h('span', { className: 'hx-faint' }, `${fmt(rows.length)} 个`)),
              err ? h('div', { className: 'hx-err', style: { marginTop: 6 } }, err) : null),
            h('div', { className: 'hx-scroll', style: { flex: 1 } },
              h('table', {}, h('thead', {}, h('tr', {}, ['机构', '本地代码', '名称', '次数', '对照', ''].map((x, i) => h('th', { key: i }, x)))),
                h('tbody', {}, rows.slice(0, 500).flatMap((c) => {
                  const cur = c.current
                  const row = h('tr', { key: c.key, className: edit?.key === c.key ? 'sel' : '' },
                    h('td', { className: 'hx-num hx-faint' }, c.scope ?? ''), h('td', { className: 'hx-num' }, c.code ?? ''), h('td', {}, c.display ?? ''), h('td', { className: 'hx-num' }, fmt(c.count)),
                    h('td', {}, cur ? h(React.Fragment, {}, h('span', { className: `hx-chip ${cur.status === 'confirmed' ? 'ok' : 'w'}` }, cur.status === 'confirmed' ? EQ[cur.equivalence] ?? cur.equivalence : '待确认'), cur.to ? h('span', { className: 'hx-num' }, `${cur.to.code} ${cur.to.display ?? ''}`) : null, cur.source === 'review' ? h('span', { className: 'hx-chip t', style: { marginLeft: 4 } }, '本机复核') : null, cur.source === 'model' ? h('span', { className: 'hx-chip vio', style: { marginLeft: 4 }, title: [cur.note, cur.verifiedBy ? `插件校验：${cur.verifiedBy}` : '', ...(cur.trail ?? []).map((x) => `R${x.round} ${x.step}${x.ok === false ? ' 报出问题' : x.ok ? ' 通过' : ''}${x.revise === true ? ' 改正' : x.revise === false ? ' 坚持' : ''} ${x.reason ?? ''}`)].filter(Boolean).join('\n') }, cur.status === 'confirmed' ? '模型 · 未复核' : '模型') : null, (cur.candidates ?? []).map((x, i) => h('span', { key: i, className: 'hx-num hx-faint', style: { marginLeft: 4 } }, `${x.by === 'verify' ? '核验' : '识别'}候选 ${x.code} ${x.display ?? ''}`)), c.changed ? h('span', { className: 'hx-chip w', style: { marginLeft: 4 } }, '下次生效') : null) : h('span', { className: 'hx-faint' }, '—')),
                    h('td', { style: { whiteSpace: 'nowrap' } }, cur?.source === 'model' && cur.status === 'confirmed' ? h('button', { className: 'hx-btn sm pri', style: { marginRight: 4 }, onClick: () => confirm(c) }, '确认') : null, h('button', { className: 'hx-btn sm', onClick: () => (edit?.key === c.key ? setEdit(null) : setEdit({ key: c.key, from: { scope: c.scope ?? undefined, code: c.code ?? undefined, display: c.display ?? undefined }, code: cur?.to?.code ?? '', display: cur?.to?.display ?? '', equivalence: cur?.equivalence ?? 'equivalent', status: cur?.status === 'pending' ? 'confirmed' : cur?.status ?? 'confirmed', note: cur?.note ?? '', code: cur?.to?.code ?? cur?.candidates?.[0]?.code ?? '', display: cur?.to?.display ?? cur?.candidates?.[0]?.display ?? '' })) }, edit?.key === c.key ? '收起' : '对照')))
                  if (edit?.key !== c.key) return [row]
                  return [row, h('tr', { key: `${c.key}-e` }, h('td', { colSpan: 6 },
                    h('div', { style: { display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', padding: '4px 0 8px' } },
                      h('label', { className: 'hx-field' }, '关系', h('select', { className: 'hx-input', value: edit.equivalence, onChange: (e) => setEdit({ ...edit, equivalence: e.target.value }) }, Object.entries(EQ).map(([k2, l]) => h('option', { key: k2, value: k2 }, l)))),
                      edit.equivalence !== 'unmatched' ? h('label', { className: 'hx-field' }, `${b.target?.name ?? ''} 代码`, h('input', { className: 'hx-input', value: edit.code, onChange: (e) => setEdit({ ...edit, code: e.target.value }), style: { width: 130 } })) : null,
                      edit.equivalence !== 'unmatched' ? h('label', { className: 'hx-field', style: { flex: 1, minWidth: 180 } }, '名称', h('input', { className: 'hx-input', value: edit.display, onChange: (e) => setEdit({ ...edit, display: e.target.value }) })) : null,
                      h('label', { className: 'hx-field' }, '状态', h('select', { className: 'hx-input', value: edit.status, onChange: (e) => setEdit({ ...edit, status: e.target.value }) }, h('option', { value: 'confirmed' }, '已确认'), h('option', { value: 'pending' }, '待确认'))),
                      h('label', { className: 'hx-field', style: { flex: 1, minWidth: 160 } }, '说明', h('input', { className: 'hx-input', value: edit.note, onChange: (e) => setEdit({ ...edit, note: e.target.value }) })),
                      h('button', { className: 'hx-btn pri', onClick: save }, '保存'))))]
                })))))))
    }

    /* ---------------------------------------------------------- 模型调用 */
    function ModelTab({ run, onTab }) {
      const d = useAsync(() => call('model', { runId: run.id }), [run.id, run.status])
      const m = run.model
      if (!m?.configured) return h('div', { className: 'hx-frame hx-pad', style: { flex: 1 } }, h('div', { className: 'hx-h' }, h('b', {}, '模型调用'), h('span', { className: 'hx-cap' }, 'MODEL')), h('div', { className: 'hx-muted' }, m?.note ?? '这一批没有使用模型。'), h('div', { className: 'hx-faint', style: { marginTop: 8, fontSize: 12 } }, '在 设置 → HL7 数据交换 → 模型 里配置识别模型和核验模型后，没有规格的表会由模型起草映射规格，无对照的取值和本地概念会由模型给出规范值和标准代码。'))
      const P = m.phases ?? {}
      const C = m.calls ?? d.value?.model?.calls
      const crossRow = (name, x, go) => x ? h('tr', { className: 'click', onClick: () => onTab(go) },
        h('td', {}, name), h('td', { className: 'hx-num' }, fmt(x.reviewed)), h('td', { className: 'hx-num' }, fmt(x.reported)), h('td', { className: 'hx-num' }, fmt(x.checkFailed)), h('td', { className: 'hx-num' }, fmt(x.revised)), h('td', { className: 'hx-num hx-warn' }, fmt(x.insisted)),
        h('td', { className: 'hx-num' }, x.reviewed ? `${(((x.reviewed - x.reported) / x.reviewed) * 100).toFixed(0)}%` : '—')) : null
      const calls = d.value?.calls ?? []
      return h('div', { className: 'hx-col hx-scroll', style: { flex: 1 } },
        h('div', { style: { display: 'flex', gap: 8 } },
          h('div', { className: 'hx-frame hx-pad', style: { flex: 1 } },
            h('div', { className: 'hx-h' }, h('b', {}, '模型'), h('span', { className: 'hx-cap' }, 'MODELS')),
            h('div', { className: 'hx-kv hx-kv-tight' },
              h('span', { className: 'hx-faint' }, '识别'), h('span', { className: 'hx-num' }, `${m.models?.suggest ?? '—'} · ${m.endpoint ?? ''}`),
              h('span', { className: 'hx-faint' }, '核验（盲审）'), h('span', { className: 'hx-num' }, m.models?.verify ? `${m.models.verify} · ${m.verifyEndpoint ?? ''}` : '同识别模型'),
              h('span', { className: 'hx-faint' }, '轮次上限'), h('span', { className: 'hx-num' }, `${m.maxRounds}（起草 → 插件校验 → 盲审 → 复判修正）`),
              h('span', { className: 'hx-faint' }, '并发 · 超时'), h('span', { className: 'hx-num' }, `${m.concurrency} / 模型 · ${Math.round((m.timeoutMs ?? 0) / 1000)} 秒 · 思考模式${m.disableThinking ? '关闭' : '开启'}`),
              h('span', { className: 'hx-faint' }, '调用'), h('span', { className: 'hx-num' }, C ? `${fmt(C.total)} 次（实发 ${fmt(C.live)}，缓存 ${fmt(C.cached)}，失败 ${fmt(C.failed)}）· ${fmt(C.tokens)} token` : '—'))),
          h('div', { className: 'hx-frame hx-pad', style: { flex: 1.3 } },
            h('div', { className: 'hx-h' }, h('b', {}, '三个阶段'), h('span', { className: 'hx-cap' }, 'RESULTS')),
            h('table', {}, h('thead', {}, h('tr', {}, ['阶段', '交给模型', '两模型一致 · 采用', '转人工复核', '模型放弃', '失败'].map((x) => h('th', { key: x }, x)))),
              h('tbody', {},
                P.schema ? h('tr', { className: 'click', onClick: () => onTab('schema') }, h('td', {}, '① Schema 起草'), h('td', { className: 'hx-num' }, `${fmt(P.schema.tables)} 张表`), h('td', { className: 'hx-num hx-ok' }, fmt(P.schema.applied)), h('td', { className: 'hx-num hx-warn' }, fmt(P.schema.review)), h('td', {}, '—'), h('td', { className: 'hx-num' }, fmt(P.schema.failed))) : null,
                P.values ? h('tr', { className: 'click', onClick: () => onTab('domains') }, h('td', {}, '② 值域归一'), h('td', { className: 'hx-num' }, `${fmt(P.values.asked)} 个取值`), h('td', { className: 'hx-num hx-ok' }, fmt(P.values.confirmed + P.values.text + P.values.invalid)), h('td', { className: 'hx-num hx-warn' }, fmt(P.values.pending)), h('td', {}, '—'), h('td', { className: 'hx-num' }, fmt(P.values.failed))) : null,
                P.terms ? h('tr', { className: 'click', onClick: () => onTab('terms') }, h('td', {}, '③ 术语对照'), h('td', { className: 'hx-num' }, `${fmt(P.terms.asked)} 个概念`), h('td', { className: 'hx-num hx-ok' }, fmt(P.terms.confirmed)), h('td', { className: 'hx-num hx-warn' }, fmt(P.terms.review)), h('td', { className: 'hx-num' }, fmt(P.terms.abstain)), h('td', { className: 'hx-num' }, fmt(P.terms.failed))) : null)),
            h('div', { className: 'hx-faint', style: { fontSize: 11.5, marginTop: 6 } }, '采用的结果标为“模型 · 未复核”，可在对应页面确认或改正；结果存本机对照表，下次运行直接复用。'))),
        h('div', { className: 'hx-frame hx-pad' },
          h('div', { className: 'hx-h' }, h('b', {}, '交叉核验'), h('span', { className: 'hx-cap' }, 'CROSS-CHECK'), h('span', { className: 'hx-faint' }, '核验模型只看“输入 + 结论”，不看识别模型的理由')),
          h('table', {}, h('thead', {}, h('tr', {}, ['阶段', '盲审', '报出问题', '插件校验拦下', '复判改正', '坚持（分歧 → 人工）', '一次通过'].map((x) => h('th', { key: x }, x)))),
            h('tbody', {}, crossRow('① Schema 起草', P.schema?.cross, 'schema'), crossRow('② 值域归一', P.values?.cross, 'domains'), crossRow('③ 术语对照', P.terms?.cross, 'terms')))),
        h('div', { className: 'hx-frame hx-pad' },
          h('div', { className: 'hx-h' }, h('b', {}, '按环节'), h('span', { className: 'hx-cap' }, 'CALLS')),
          C?.byPhase?.length ? h('table', {}, h('thead', {}, h('tr', {}, ['环节', '模型', '调用', '缓存', '失败', '条目', '平均耗时', 'token'].map((x) => h('th', { key: x }, x)))),
            h('tbody', {}, C.byPhase.map((x, i) => h('tr', { key: i }, h('td', {}, x.phase), h('td', { className: 'hx-num hx-faint' }, x.model), h('td', { className: 'hx-num' }, fmt(x.calls)), h('td', { className: 'hx-num' }, fmt(x.cached)), h('td', { className: `hx-num ${x.failed ? 'hx-bad' : ''}` }, fmt(x.failed)), h('td', { className: 'hx-num' }, fmt(x.items)), h('td', { className: 'hx-num' }, x.calls - x.cached ? `${((x.ms / Math.max(1, x.calls - x.cached)) / 1000).toFixed(1)} s` : '—'), h('td', { className: 'hx-num' }, fmt(x.tokens)))))) : h('div', { className: 'hx-faint' }, '—')),
        h('div', { className: 'hx-frame hx-pad' },
          h('div', { className: 'hx-h' }, h('b', {}, '最近的调用'), h('span', { className: 'hx-faint' }, '只记录大小、耗时和 token，不记录内容')),
          calls.length ? h('table', {}, h('thead', {}, h('tr', {}, ['时间', '环节', '轮', '模型', '条目', '结果', '耗时', 'token'].map((x) => h('th', { key: x }, x)))),
            h('tbody', {}, calls.slice(-60).reverse().map((c, i) => h('tr', { key: i }, h('td', { className: 'hx-num hx-faint' }, shortTime(c.at)), h('td', {}, c.phase), h('td', { className: 'hx-num' }, c.round), h('td', { className: 'hx-num hx-faint' }, c.model), h('td', { className: 'hx-num' }, c.items), h('td', {}, c.cached ? h('span', { className: 'hx-chip t' }, '缓存') : c.ok ? h('span', { className: 'hx-chip ok' }, '成功') : h('span', { className: 'hx-chip b', title: c.error }, '失败')), h('td', { className: 'hx-num' }, c.ms ? `${(c.ms / 1000).toFixed(1)} s` : '—'), h('td', { className: 'hx-num' }, c.tokens ?? '—'))))) : h('div', { className: 'hx-faint' }, d.error ?? '—')))
    }

    function Report({ run }) {
      const d = useAsync(() => call('report', { runId: run.id }), [run.id, run.status])
      return h('div', { className: 'hx-frame hx-scroll hx-pad', style: { flex: 1 } },
        d.value ? h(React.Fragment, {}, h('div', { className: 'hx-faint', style: { marginBottom: 8 } }, d.value.path), h('div', { className: 'hx-md' }, d.value.markdown)) : h('div', { className: 'hx-faint' }, d.error ?? '加载中…'))
    }

    /* --------------------------------------------------------------- settings */
    function SettingsSection() {
      const [form, setForm] = useState(null)
      const [state, setState] = useState('')
      const [test, setTest] = useState(null)
      useEffect(() => { call('config').then((c) => setForm({ ...c, apiKey: '' })).catch((e) => setState(msg(e))) }, [])
      if (!form) return h('div', { className: 'hx-settings' }, h('style', {}, CSS), state || '加载中…')
      const field = (k, label, props = {}) => h('label', { className: 'hx-field' }, label, h('input', { className: 'hx-input', value: form[k] ?? '', onChange: (e) => setForm({ ...form, [k]: e.target.value }), ...props }))
      const check = (k, label) => h('label', { style: { display: 'flex', gap: 6, alignItems: 'center' } }, h('input', { type: 'checkbox', checked: form[k] !== false, onChange: (e) => setForm({ ...form, [k]: e.target.checked }) }), label)
      const num = (v, d) => (Number.isFinite(Number(v)) && String(v).trim() !== '' ? Number(v) : d)
      const save = async () => {
        const patch = {
          loincZhTable: form.loincZhTable ?? '', snomedTable: form.snomedTable ?? '',
          outputRoot: form.outputRoot ?? '', namespace: form.namespace || 'http://dsh.local/fhir', timezone: form.timezone || '+08:00', profilesDir: form.profilesDir ?? '',
          residualGate: form.residualGate === 'warn' ? 'warn' : 'block', outputFormat: ['bundles', 'ndjson'].includes(form.outputFormat) ? form.outputFormat : 'both',
          validatorJar: form.validatorJar ?? '', validatorSample: num(form.validatorSample, 2), javaPath: form.javaPath || 'java',
          modelEnabled: form.modelEnabled !== false, baseURL: form.baseURL ?? '', model: form.model ?? '', verifyBaseURL: form.verifyBaseURL ?? '', verifyModel: form.verifyModel ?? '',
          disableThinking: form.disableThinking !== false, timeoutMs: num(form.timeoutMs, 120000), temperature: num(form.temperature, 0), modelConcurrency: num(form.modelConcurrency, 4),
          maxRounds: Math.min(6, Math.max(1, num(form.maxRounds, 3))), valueLimit: num(form.valueLimit, 300), termLimit: num(form.termLimit, 500), loincTable: form.loincTable ?? '',
        }
        if (form.apiKey) patch.apiKey = form.apiKey
        try { await call('saveDefaults', patch); setState('已保存（插件会重新加载）') } catch (e) { setState(msg(e)) }
      }
      const runTest = async () => {
        setTest({ busy: true })
        try { setTest(await call('testConnection', { baseURL: form.baseURL, model: form.model, verifyBaseURL: form.verifyBaseURL, verifyModel: form.verifyModel, apiKey: form.apiKey || undefined })) } catch (e) { setTest({ error: msg(e) }) }
      }
      const testLine = (role, label) => {
        const x = test?.[role]
        if (!x) return null
        return h('div', { style: { fontSize: 12, color: x.ok ? 'var(--dsw-alias-state-success-primary)' : x.skipped ? 'var(--dsw-alias-label-secondary)' : 'var(--dsw-alias-state-error-primary)' } }, `${label}：${x.skipped ? '未配置' : x.message}${!x.ok && x.models?.length ? `（端点上有：${x.models.join('、')}）` : ''}`)
      }
      return h('div', { className: 'hx-settings' }, h('style', {}, CSS),
        h('p', { style: { margin: 0, color: 'var(--dsw-alias-label-secondary)' } }, `这里只放配置。运行批次、复核对照，请到左侧栏的「${TITLE}」，或在聊天框使用 /hl7。`),
        h('h3', { style: { margin: '6px 0 0' } }, '模型'),
        h('p', { style: { margin: 0, fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } }, '用于：给没有规格的表起草映射规格（Schema 同构）、给无对照的取值找规范值（值域归一）、给本地概念找 LOINC / SNOMED CT 等标准代码（术语对照）。模型结果经插件校验和独立盲审、复判，两模型一致才采用，有分歧的转人工复核，结果存本机对照表、下次复用。病历内容只发往这里配置的端点；发送的只是字段名、截短的取值样例和本地代码 / 名称，不发文书正文。Agent 不能更改这些设置。'),
        check('modelEnabled', '启用模型'),
        h('div', { className: 'hx-grid2' },
          field('baseURL', '识别模型端点（OpenAI 兼容，以 /v1 结尾）', { placeholder: 'http://127.0.0.1:11434/v1' }), field('model', '识别模型'),
          field('verifyBaseURL', '核验模型端点（空＝同上）'), field('verifyModel', '核验模型（独立盲审；空＝用识别模型盲审）'),
          field('apiKey', form.apiKeySet ? 'API Key（已设置；留空不修改）' : 'API Key（可空）', { type: 'password' }), field('timeoutMs', '单次调用超时（毫秒）'),
          field('modelConcurrency', '每个模型同时处理的请求数'), field('maxRounds', '核验轮次上限（1–6）'),
          field('temperature', '温度'), field('loincTable', 'LOINC 代码表：LoincTable/Loinc.csv'),
          field('loincZhTable', 'LOINC 中文变体：LinguisticVariants/zhCN…LinguisticVariant.csv（建议）'), field('snomedTable', 'SNOMED CT 描述表：sct2_Description_Snapshot-….txt'),
          field('valueLimit', '每个值域最多交给模型的取值数'), field('termLimit', '每组术语对照最多交给模型的概念数')),
        h('p', { style: { margin: 0, fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } }, '术语对照的候选只从本地代码表里检索，模型只在候选里选、核验模型独立再选一次，两者相同才采用。没有配置代码表的标准不交给模型（实测模型凭记忆给的代码约一半是编的）。LOINC 在 loinc.org 免费注册后下载。'),
        check('disableThinking', '关闭思考模式（推理模型更快）'),
        h('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } }, h('button', { className: 'hx-btn', onClick: runTest, disabled: test?.busy }, test?.busy ? '测试中…' : '测试连接'), test?.error ? h('span', { style: { color: 'var(--dsw-alias-state-error-primary)', fontSize: 12 } }, test.error) : null),
        testLine('suggest', '识别模型'), testLine('verify', '核验模型'),
        h('h3', { style: { margin: '6px 0 0' } }, '转换'),
        h('div', { className: 'hx-grid2' },
          field('namespace', '命名空间（标识、代码体系、扩展的网址前缀；确定后不要再改）'),
          field('timezone', '源数据无时区时按此时区（如 +08:00）'),
          field('outputRoot', '默认输出根目录（空＝输入旁的 _medical-hl7）'),
          field('profilesDir', '额外映射规格目录（*.mjs / *.json，可空）')),
        h('label', { className: 'hx-field' }, '交付格式',
          h('select', { className: 'hx-input', value: form.outputFormat ?? 'both', onChange: (e) => setForm({ ...form, outputFormat: e.target.value }) },
            h('option', { value: 'both' }, '两种都存：按人 bundles/ ＋ 按资源类型 ndjson/'),
            h('option', { value: 'bundles' }, '只存按人 bundles/（导入 FHIR 服务器、单人交换）'),
            h('option', { value: 'ndjson' }, '只存按资源类型 ndjson/（批量导入、数据分析；页面不能按病人浏览资源）'))),
        h('h3', { style: { margin: '6px 0 0' } }, '验收'),
        h('label', { className: 'hx-field' }, '发现像真实身份证号/手机号的内容时',
          h('select', { className: 'hx-input', value: form.residualGate ?? 'block', onChange: (e) => setForm({ ...form, residualGate: e.target.value }) },
            h('option', { value: 'block' }, '该病人暂扣，不交付'), h('option', { value: 'warn' }, '只在报告里提示'))),
        h('div', { className: 'hx-grid2' },
          field('validatorJar', '官方 HL7 Validator（validator_cli.jar）路径；空＝只做内置校验'),
          field('validatorSample', '每批抽检几位病人'),
          field('javaPath', 'Java 可执行文件')),
        h('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } }, h('button', { className: 'hx-btn', onClick: save }, '保存'), h('span', { style: { color: 'var(--dsw-alias-label-secondary)' } }, state)))
    }

    /* ----------------------------------------------------------------- plugin */
    return {
      inject: ['slots'],
      apply(ctx) {
        services.ctx = ctx
        ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: PANEL_ID, order: 32, label: () => TITLE }, SettingsSection))
        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID }, Page))
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 32, label: () => TITLE }, Icon))
      },
    }
  },
})
