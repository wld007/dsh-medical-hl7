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
      const tabs = [['overview', '◈ 概览'], ['schema', '① Schema 同构'], ['domains', '② 值域归一', st ? (st.domains.pending + st.domains.unmapped) || null : null], ['terms', '③ 术语对照'], ['patients', '病人', t?.held || null], ['resources', '资源浏览'], ['report', '报告']]
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
            : tab === 'overview' ? h(Overview, { run, openPatient, onTab: setTab })
              : tab === 'patients' ? h(Patients, { run, patient, setPatient, openPatient })
                : tab === 'resources' ? h(Resources, { run, patient, setPatient })
                  : tab === 'schema' ? h(SchemaTab, { run })
                  : tab === 'domains' ? h(DomainsTab, { run, onRerun: rerun })
                  : tab === 'terms' ? h(TermsTab, { run, onRerun: rerun })
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

    /* --------------------------------------------------------------- overview */
    function Overview({ run, openPatient, onTab }) {
      const P = run.patients
      const t = run.totals
      const running = run.status === 'running'
      const frac = t.units ? (run.units?.length ?? 0) / t.units : 0
      const byType = {}
      for (const p of P) for (const [k, n] of Object.entries(p.byType ?? {})) byType[k] = (byType[k] ?? 0) + n
      const types = Object.entries(byType).sort((a, b) => byOrder(a[0], b[0]))
      const max = Math.max(1, ...types.map(([, n]) => n))
      const tables = Object.keys(run.tables ?? {}).length
      const inferred = run.inferred?.length ?? 0
      const S = run.stages
      const st = (no, nm, sub, big, unit, state, f, onClick) => h('div', { className: `hx-st ${state}`, style: onClick ? { cursor: 'pointer' } : undefined, onClick, title: onClick ? '点开查看' : undefined },
        h('div', { className: 'bar' }, h('span', { style: { width: `${Math.round((f ?? frac) * 100)}%` } })),
        h('div', { className: 'no' }, no), h('div', { className: 'nm' }, nm), h('div', { className: 'sub' }, sub),
        h('div', { className: 'big' }, big, h('small', {}, unit)))
      const s = running ? 'run' : 'done'
      const arrow = (k) => h('span', { key: k, className: 'hx-arrow' }, '→')
      return h('div', { className: 'hx-col hx-scroll', style: { flex: 1 } },
        h('div', { className: 'hx-frame hx-pad' },
          h('div', { className: 'hx-h' }, h('b', {}, '处理流程'), h('span', { className: 'hx-cap' }, 'PIPELINE'), h('span', { className: 'hx-sp' }), h('span', { className: 'hx-faint' }, run.input)),
          h('div', { style: { display: 'flex', gap: 6 } },
            st('读取', '读取分组', '按目录、按病人编号归并；源文件只读', `${fmt(run.units?.length)}/${fmt(t.units)}`, '目录', s),
            arrow(1),
            st('①', 'Schema 同构', '表 → 类别，字段 → 角色；只搬不改', S ? fmt(S.schema.tables) : fmt(tables), S ? `张表 · 保留 ${fmt(S.schema.extrasFields)} 字段` : '张表', s, undefined, () => onTab('schema')),
            arrow(2),
            st('②', '值域归一', '写法统一到规范值；不确定的待确认', S ? `${(S.domains.coverage * 100).toFixed(1)}%` : '—', S ? `待确认 ${fmt(S.domains.pending)}` : '', S && S.domains.pending + S.domains.unmapped ? 'hold' : s, 1, () => onTab('domains')),
            arrow(3),
            st('③', '术语对照', '本地概念 → LOINC / SNOMED CT 等', S ? `${fmt(S.terminology.mappedConcepts)}/${fmt(S.terminology.concepts)}` : '—', '概念已对照', s, 1, () => onTab('terms')),
            arrow(4),
            st('④', 'FHIR 组装', '只拼装，不解析', fmt(t.resources), '资源', s),
            arrow(5),
            st('验收', '验收', '结构、引用、残留身份证号/手机号', t.held ? `${t.held} 暂扣` : `${fmt(t.done)} 通过`, '', t.held ? 'hold' : s, 1),
            arrow(6),
            st('交付', '交付', 'Bundle · NDJSON · 定义', run.output ? '✓' : '—', run.output ? '已交付' : '未交付', run.output ? 'done' : 'idle', run.output ? 1 : 0)),
          (run.warnings ?? []).length ? h('div', { style: { marginTop: 10 } }, [...new Set(run.warnings)].slice(0, 8).map((w, i) => h('div', { key: i, className: 'hx-warn' }, `⚠ ${w}`))) : null,
          run.error ? h('div', { className: 'hx-err', style: { marginTop: 8 } }, String(run.error).split('\n')[0]) : null,
          run.output ? h('div', { className: 'hx-muted', style: { marginTop: 8 } }, '交付目录：', h('span', { className: 'hx-num' }, run.output)) : null),
        h('div', { style: { display: 'flex', gap: 8, minHeight: 0 } },
          h('div', { className: 'hx-frame hx-pad', style: { flex: 1 } },
            h('div', { className: 'hx-h' }, h('b', {}, '病人'), h('span', { className: 'hx-cap' }, 'PATIENTS'), h('span', { className: 'hx-faint' }, '每格 1 位，点开浏览资源')),
            h('div', { className: 'hx-cells' }, P.map((p) => h('i', { key: p.name, title: `${p.name}：${p.status === 'held' ? '暂扣' : '交付'}，资源 ${p.resources}`, className: p.status === 'held' ? 'w' : 'o', onClick: () => openPatient(p.name) }))),
            h('div', { className: 'hx-bigs', style: { marginTop: 14 } },
              h('div', {}, h('small', {}, '病人'), h('span', { className: 'hx-num' }, fmt(t.patients))),
              h('div', {}, h('small', {}, '资源'), h('span', { className: 'hx-num' }, fmt(t.resources))),
              h('div', {}, h('small', {}, '结构错误'), h('span', { className: `hx-num ${t.errors ? 'hx-bad' : 'hx-ok'}` }, fmt(t.errors))),
              h('div', {}, h('small', {}, '暂扣'), h('span', { className: `hx-num ${t.held ? 'hx-warn' : ''}` }, fmt(t.held))),
              h('div', {}, h('small', {}, '登记缺失的就诊'), h('span', { className: 'hx-num hx-muted' }, fmt(t.unresolvedEncounters)))),
            h('table', {}, h('tbody', {},
              h('tr', {}, h('td', {}, '源文件只读核对'), h('td', { className: run.sourceCheck ? (run.sourceCheck.changed ? 'hx-warn' : 'hx-ok') : 'hx-faint' }, run.sourceCheck ? (run.sourceCheck.changed ? `${run.sourceCheck.changed} 个变化` : `${fmt(run.sourceCheck.files)} 个文件，一致`) : '—')),
              h('tr', {}, h('td', {}, '输入来源'), h('td', { className: run.provenance?.kind === 'delivered' ? 'hx-ok' : 'hx-warn' }, run.provenance?.note ?? '—')),
              h('tr', {}, h('td', {}, '附带定义'), h('td', {}, run.definitions ? `${run.definitions.StructureDefinition} 个扩展 · ${run.definitions.CodeSystem} 个本地代码体系` : '—'))))),
          h('div', { className: 'hx-frame hx-pad', style: { flex: 1.2 } },
            h('div', { className: 'hx-h' }, h('b', {}, '资源类型'), h('span', { className: 'hx-cap' }, 'FHIR RESOURCES')),
            types.length ? h('div', { className: 'hx-bars' }, types.flatMap(([k, n]) => [
              h('span', { key: `${k}a` }, k, h('span', { className: 'hx-faint' }, ` ${TYPE_ZH[k] ?? ''}`)),
              h('div', { key: `${k}b`, className: 'track' }, h('span', { style: { width: `${(n / max) * 100}%` } })),
              h('span', { key: `${k}c`, className: 'hx-num hx-muted' }, fmt(n)),
            ])) : h('div', { className: 'hx-faint' }, running ? '转换中…' : '—'))))
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
    function SchemaTab({ run }) {
      const d = useAsync(() => call('schema', { runId: run.id }), [run.id, run.status])
      const [sel, setSel] = useState(null)
      if (!d.value) return h('div', { className: 'hx-frame hx-pad', style: { flex: 1 } }, h('span', { className: 'hx-faint' }, d.error ?? '加载中…'))
      const tables = d.value.tables
      const t = tables.find((x) => x.table === sel) ?? tables[0]
      return h('div', { style: { display: 'flex', gap: 8, flex: 1, minHeight: 0 } },
        h('div', { className: 'hx-frame hx-scroll', style: { width: 380, flex: 'none' } },
          h('div', { className: 'hx-pad', style: { paddingBottom: 4 } }, h('div', { className: 'hx-h' }, h('b', {}, '① Schema 同构'), h('span', { className: 'hx-cap' }, 'HARMONIZE')),
            h('div', { className: 'hx-muted', style: { fontSize: 11.5, lineHeight: 1.6 } }, '表 → 记录类别，字段 → 语义角色。只搬不改：这一步不解释任何取值。没有对应角色的字段原样保留。')),
          h('table', {}, h('thead', {}, h('tr', {}, ['表', '类别', '行数', '保留字段'].map((x) => h('th', { key: x }, x)))),
            h('tbody', {}, tables.map((x) => h('tr', { key: x.table, className: `click${x === t ? ' sel' : ''}`, onClick: () => setSel(x.table) },
              h('td', { className: 'hx-num' }, x.table, x.inferred ? h('span', { className: 'hx-chip w', style: { marginLeft: 6 } }, '自动推断') : null),
              h('td', {}, h('span', { className: 'hx-chip t' }, x.kind)), h('td', { className: 'hx-num' }, fmt(x.rows)), h('td', { className: 'hx-num hx-faint' }, fmt(x.extras.length))))))),
        !t ? h('div', { className: 'hx-frame hx-pad', style: { flex: 1 } }, '—') : h('div', { className: 'hx-frame hx-scroll hx-pad', style: { flex: 1 } },
          h('div', { className: 'hx-h' }, h('b', { className: 'hx-num' }, t.table), h('span', { className: 'hx-chip t' }, t.kind), h('span', { className: 'hx-faint' }, `${t.profile === 'auto' ? '自动推断' : `规格 ${t.profile}`} · ${t.file ?? ''} · ${fmt(t.rows)} 行${t.invalid ? ` · 作废 ${t.invalid}` : ''}`)),
          t.inferred ? h('div', { className: 'hx-text', style: { fontSize: 12 } }, `没有现成规格，按 Basic 保留全部字段。建议类别：${t.suggestedKind ?? '—'}。推断依据：\n${t.reasons.join('\n') || '—'}`) : null,
          h('div', { className: 'hx-sec' }, h('b', {}, '角色'), h('span', { className: 'hx-faint' }, '字段 → 语义角色；多个字段时取第一个有值的')),
          h('table', {}, h('thead', {}, h('tr', {}, ['角色', '来源字段', '有值', '填充率', '值域'].map((x) => h('th', { key: x }, x)))),
            h('tbody', {}, t.roles.map((r) => h('tr', { key: r.role },
              h('td', { className: 'hx-num' }, r.role), h('td', { className: 'hx-num hx-muted' }, r.fields.join(' → ')),
              h('td', { className: 'hx-num' }, fmt(r.filled)),
              h('td', {}, h('div', { className: 'hx-bars', style: { gridTemplateColumns: '1fr auto' } }, h('div', { className: 'track' }, h('span', { style: { width: `${t.rows ? (r.filled / t.rows) * 100 : 0}%` } })), h('span', { className: 'hx-num hx-faint' }, `${t.rows ? Math.round((r.filled / t.rows) * 100) : 0}%`))),
              h('td', { className: 'hx-num hx-faint' }, r.domain ?? ''))))),
          h('div', { className: 'hx-sec' }, h('b', {}, '原样保留的字段'), h('span', { className: 'hx-faint' }, 'source-field 扩展；出现多的值得补进规格')),
          t.extras.length ? h('div', {}, t.extras.map(([f, n]) => h('span', { key: f, className: 'hx-chip' }, `${f} · ${fmt(n)}`))) : h('div', { className: 'hx-faint' }, '无'),
          t.fields ? h(React.Fragment, {}, h('div', { className: 'hx-sec' }, h('b', {}, '字段画像')), h('div', {}, t.fields.map((f) => h('span', { key: f.name, className: `hx-chip${f.pseudonym ? ' w' : f.time ? ' t' : ''}`, title: `填充 ${f.fill}%${f.pseudonym ? ` · ${f.pseudonym}假名` : ''}${f.time ? ' · 时间' : ''}` }, f.name)))) : null))
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
      const rows = (dom?.values ?? []).filter((v) => filter === 'all' || (filter === 'open' ? open(v) : v.status === filter))
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
                dom.kind === 'enum' ? h('select', { className: 'hx-input', value: filter, onChange: (e) => setFilter(e.target.value) }, h('option', { value: 'open' }, '待处理（待确认/无对照/不属于/已改）'), h('option', { value: 'all' }, '全部'), ...Object.keys(DST).map((k) => h('option', { key: k, value: k }, DST[k][0]))) : null),
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
                    h('td', {}, cur ? h(React.Fragment, {}, h('span', { className: `hx-chip ${cur.status === 'confirmed' ? 'ok' : cur.status === 'invalid' ? 'b' : cur.status === 'text' ? 't' : 'w'}` }, ENTRY_ST[cur.status]), cur.to ? h('span', { className: 'hx-num' }, `→ ${cur.to}${tv(cur.to)?.label ? ` ${tv(cur.to).label}` : ''}`) : null, cur.source === 'review' ? h('span', { className: 'hx-chip t', style: { marginLeft: 4 } }, '本机复核') : null, v.changed ? h('span', { className: 'hx-chip w', style: { marginLeft: 4 } }, '下次生效') : null) : h('span', { className: 'hx-faint' }, '—')),
                    h('td', { className: 'hx-faint', style: { fontSize: 11.5, maxWidth: 280 } }, cur?.note ?? v.note ?? ''),
                    h('td', {}, dom.kind === 'enum' ? h('button', { className: 'hx-btn sm', onClick: () => (edit?.key === k ? setEdit(null) : startEdit(v)) }, edit?.key === k ? '收起' : '复核') : null))
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
      const rows = (b?.items ?? []).filter((c) => (filter === 'all' || (filter === 'mapped' ? mapped(c) : !mapped(c))) && (!q || `${c.code ?? ''} ${c.display ?? ''}`.toLowerCase().includes(q.toLowerCase())))
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
                h('select', { className: 'hx-input', value: filter, onChange: (e) => setFilter(e.target.value) }, h('option', { value: 'unmapped' }, '未对照'), h('option', { value: 'mapped' }, '已对照'), h('option', { value: 'all' }, '全部')),
                h('input', { className: 'hx-input', placeholder: '筛选代码/名称…', value: q, onChange: (e) => setQ(e.target.value) }), h('span', { className: 'hx-faint' }, `${fmt(rows.length)} 个`)),
              err ? h('div', { className: 'hx-err', style: { marginTop: 6 } }, err) : null),
            h('div', { className: 'hx-scroll', style: { flex: 1 } },
              h('table', {}, h('thead', {}, h('tr', {}, ['机构', '本地代码', '名称', '次数', '对照', ''].map((x, i) => h('th', { key: i }, x)))),
                h('tbody', {}, rows.slice(0, 500).flatMap((c) => {
                  const cur = c.current
                  const row = h('tr', { key: c.key, className: edit?.key === c.key ? 'sel' : '' },
                    h('td', { className: 'hx-num hx-faint' }, c.scope ?? ''), h('td', { className: 'hx-num' }, c.code ?? ''), h('td', {}, c.display ?? ''), h('td', { className: 'hx-num' }, fmt(c.count)),
                    h('td', {}, cur ? h(React.Fragment, {}, h('span', { className: `hx-chip ${cur.status === 'confirmed' ? 'ok' : 'w'}` }, cur.status === 'confirmed' ? EQ[cur.equivalence] ?? cur.equivalence : '待确认'), cur.to ? h('span', { className: 'hx-num' }, `${cur.to.code} ${cur.to.display ?? ''}`) : null, cur.source === 'review' ? h('span', { className: 'hx-chip t', style: { marginLeft: 4 } }, '本机复核') : null, c.changed ? h('span', { className: 'hx-chip w', style: { marginLeft: 4 } }, '下次生效') : null) : h('span', { className: 'hx-faint' }, '—')),
                    h('td', {}, h('button', { className: 'hx-btn sm', onClick: () => (edit?.key === c.key ? setEdit(null) : setEdit({ key: c.key, from: { scope: c.scope ?? undefined, code: c.code ?? undefined, display: c.display ?? undefined }, code: cur?.to?.code ?? '', display: cur?.to?.display ?? '', equivalence: cur?.equivalence ?? 'equivalent', status: cur?.status ?? 'confirmed', note: cur?.note ?? '' })) }, edit?.key === c.key ? '收起' : '对照')))
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

    function Report({ run }) {
      const d = useAsync(() => call('report', { runId: run.id }), [run.id, run.status])
      return h('div', { className: 'hx-frame hx-scroll hx-pad', style: { flex: 1 } },
        d.value ? h(React.Fragment, {}, h('div', { className: 'hx-faint', style: { marginBottom: 8 } }, d.value.path), h('div', { className: 'hx-md' }, d.value.markdown)) : h('div', { className: 'hx-faint' }, d.error ?? '加载中…'))
    }

    /* --------------------------------------------------------------- settings */
    function SettingsSection() {
      const [form, setForm] = useState(null)
      const [state, setState] = useState('')
      useEffect(() => { call('config').then(setForm).catch((e) => setState(msg(e))) }, [])
      if (!form) return h('div', { className: 'hx-settings' }, h('style', {}, CSS), state || '加载中…')
      const field = (k, label, props = {}) => h('label', { className: 'hx-field' }, label, h('input', { className: 'hx-input', value: form[k] ?? '', onChange: (e) => setForm({ ...form, [k]: e.target.value }), ...props }))
      const save = async () => {
        const patch = { outputRoot: form.outputRoot ?? '', namespace: form.namespace || 'http://dsh.local/fhir', timezone: form.timezone || '+08:00', profilesDir: form.profilesDir ?? '', residualGate: form.residualGate === 'warn' ? 'warn' : 'block', outputFormat: ['bundles', 'ndjson'].includes(form.outputFormat) ? form.outputFormat : 'both', validatorJar: form.validatorJar ?? '', validatorSample: Number(form.validatorSample) || 2, javaPath: form.javaPath || 'java' }
        try { await call('saveDefaults', patch); setState('已保存（插件会重新加载）') } catch (e) { setState(msg(e)) }
      }
      return h('div', { className: 'hx-settings' }, h('style', {}, CSS),
        h('p', { style: { margin: 0, color: 'var(--dsw-alias-label-secondary)' } }, `这里只放配置。运行批次、浏览资源，请到左侧栏的「${TITLE}」，或在聊天框使用 /hl7。只在本机按规则处理，不调用模型。`),
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
