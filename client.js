window.__ModuleLoader__.load({
  id: 'dsh-medical-hl7',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useCallback, useMemo, useRef } = React
    const CHANNEL = '/medical-hl7'
    const PANEL_ID = 'medical-hl7'
    const TITLE = 'HL7 标准化'
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
.hx{--fire1:#F26B21;--fire2:#E3271C;--fireDim:rgba(242,107,33,.14);--vio:#A78BFA;--flame:linear-gradient(160deg,#F7A823,#F26B21 55%,#E3271C)}
.hx.hx-light{--bg:#efe9e2;--panel:#f8f4ef;--panel2:#f1ebe4;--panel3:#ebe3da;--line:#e0d6cb;--line2:#cfc2b4;--ink:#2a211b;--ink2:#6b5d52;--ink3:#9a8b7f;--teal:#4a3b30;--teal2:#2a211b;--tealdim:rgba(74,59,48,.07);--ok:#1E9E5A;--warn:#B98900;--bad:#C2185B;--vio:#7C5CE6;--fire1:#EA6A1F;--fire2:#D23A16;--fireDim:rgba(234,106,31,.12);--neutral:#cdbfb1;--track:#e6ddd3;--tint:#f4eee8;color-scheme:light}
.hx.hx-dark{--bg:#111213;--panel:#18191b;--panel2:#1f2023;--panel3:#26282b;--line:#2b2d30;--line2:#3a3d41;--ink:#e7e8ea;--ink2:#a2a6ab;--ink3:#6c7076;--teal:#d6d9dd;--teal2:#ffffff;--tealdim:rgba(255,255,255,.06);--ok:#3FBF7F;--warn:#E9C341;--bad:#E5487A;--vio:#A78BFA;--neutral:#45484d;--track:#2a2c30;--tint:#1c1d20;color-scheme:dark}
.hx.hx-dark .hx-frame{box-shadow:none}

.hx-frame{border:1px solid var(--line);background:var(--panel);border-radius:6px;box-shadow:0 1px 2px color-mix(in srgb,var(--dsw-alias-label-primary) 6%,transparent)}
.hx-top{display:flex;align-items:center;gap:14px;padding:7px 12px 7px 14px;border-left:3px solid var(--fire1);position:relative;z-index:20}
.hx-brandbox{display:flex;align-items:center;gap:10px;flex:none}
.hx-status{display:flex;align-items:center;gap:9px;padding:4px 12px 4px 10px;border-radius:8px;border:1px solid var(--line2);min-width:170px}
.hx-status>div{display:flex;flex-direction:column;line-height:16px}.hx-status b{font-size:13px}.hx-status .hx-num{font-size:11px;color:var(--ink2)}
.hx-lamp{width:9px;height:9px;border-radius:50%;background:var(--line2);flex:none}
.s-running .hx-lamp{background:var(--fire1);box-shadow:0 0 0 3px var(--fireDim);animation:hx-blink 1.2s infinite}
.s-completed .hx-lamp{background:var(--ok)}.s-review .hx-lamp{background:var(--warn)}.s-failed .hx-lamp,.s-cancelled .hx-lamp{background:var(--bad)}
.hx-src{font-size:11px;color:var(--ink2);background:none;border:0;padding:0;text-align:left;font:inherit;font-size:11px}
.hx-src.link{color:var(--fire1);cursor:pointer}.hx-src.link:hover{text-decoration:underline}
.hx-now-top{font-size:12px;color:var(--fire1);max-width:320px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.hx-clock{display:flex;flex-direction:column;align-items:flex-end;line-height:16px;padding:0 4px}
.hx-clock span{font-size:10px;color:var(--ink3);letter-spacing:1px}
.hx-clock b{font-family:var(--mono);font-size:18px;font-weight:600;letter-spacing:1px;line-height:22px}
.hx-clock.sep{padding-right:14px;margin-right:2px;border-right:1px solid var(--line)}
.hx-clock.ver b{font-size:12.5px;font-weight:500;letter-spacing:0;color:var(--ink2)}
.hx-pct{color:var(--fire1)}.hx-pct small{font-size:11px;font-weight:400;margin-left:1px;color:var(--ink2)}
.hx-act{position:relative}
.hx-btn.new{border-color:var(--fire1)!important;background:var(--fire1)!important;color:#fff!important;font-weight:600;padding:6px 14px}
.hx-btn.new:hover:not(:disabled){filter:brightness(1.06)}.hx-btn.new:disabled{background:transparent!important;color:var(--ink2)!important;border-color:var(--line2)!important;font-weight:400}
.hx-caret{margin-left:6px;font-size:10px;opacity:.85}
.hx-btn.stop{border-color:var(--bad)!important;color:var(--bad)!important;background:color-mix(in srgb,var(--bad) 8%,transparent)!important;padding:6px 14px}
.hx-btn.hbtn{padding:6px 12px;display:inline-flex;align-items:center;gap:6px;background:var(--panel)!important;border-color:var(--line2)!important;color:var(--ink)!important}.hx-btn.hbtn.on,.hx-btn.hbtn:hover{border-color:var(--fire1)!important;color:var(--fire1)!important}
.hx-hcount{font-style:normal;font-family:var(--mono);font-size:10.5px;line-height:15px;padding:0 5px;border-radius:8px;background:color-mix(in srgb,var(--ink) 8%,transparent);color:var(--ink2)}
.hx-btn.hicon{width:34px;padding:6px 0;font-size:15px;background:var(--panel)!important;border-color:var(--line2)!important;color:var(--ink2)!important}
.hx-btn.danger{border-color:var(--bad)!important;color:var(--bad)!important}
.hx-shade{position:fixed;inset:0;z-index:30}
.hx-pop{position:absolute;right:0;top:40px;z-index:40;width:460px;padding:14px 16px;border:1px solid var(--line2);border-top:2px solid var(--fire1);border-radius:8px;background:var(--panel);box-shadow:0 20px 60px rgba(0,0,0,.35);display:flex;flex-direction:column;gap:10px}
.hx-pop-h{display:flex;align-items:center;gap:8px}.hx-pop-h b{font-size:13px}
.hx-pop.runs{width:440px;max-height:70vh}
.hx-runs{overflow:auto;display:flex;flex-direction:column;gap:6px;max-height:calc(70vh - 60px)}
.hx-run{border:1px solid var(--line);border-radius:6px;padding:7px 10px;cursor:pointer;background:var(--panel2)}
.hx-run:hover{border-color:var(--line2)}.hx-run.on{border-color:var(--fire1);box-shadow:inset 3px 0 0 var(--fire1)}
.hx-run-top{display:flex;align-items:center;gap:8px}.hx-run-name{flex:1;min-width:0;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.hx-run-del{border:0;background:none;color:var(--ink3);cursor:pointer;font-size:12px;padding:0 2px}.hx-run-del:hover{color:var(--bad)}
.hx-run-meta{display:flex;flex-direction:column;font-size:11px;color:var(--ink2);margin-top:3px;line-height:16px}
.hx-run-confirm{margin-top:8px;padding:8px;border:1px solid color-mix(in srgb,var(--bad) 45%,transparent);border-radius:6px;font-size:12px;color:var(--ink2);cursor:default}
.hx-modal{position:fixed;inset:0;z-index:60;background:rgba(0,0,0,.35);display:grid;place-items:center}
.hx-modal-box{width:min(880px,92vw);height:min(760px,88vh);background:var(--panel);border:1px solid var(--line2);border-top:2px solid var(--fire1);border-radius:10px;padding:14px 18px;display:flex;flex-direction:column;gap:10px;box-shadow:0 24px 80px rgba(0,0,0,.45)}
.hx-logo{width:28px;height:28px;border-radius:7px;background:var(--flame);display:grid;place-items:center;flex:none}
.hx-brand b{display:block;font-size:14px;letter-spacing:2px}.hx-brand span{font-family:var(--mono);font-size:9.5px;color:var(--ink2);letter-spacing:1px}
.hx-runbox{border:1px solid var(--line2);border-radius:6px;padding:3px 10px;line-height:1.35;min-width:220px}
.hx-sp{flex:1}
.hx-btn{border:1px solid var(--line2);border-radius:5px;padding:4px 11px;color:var(--ink);background:var(--panel2);font-size:12px;cursor:pointer;white-space:nowrap}
.hx button.hx-btn:not(.new):not(.stop):not(.hbtn):not(.hicon):not(.danger):not(.pri){background:var(--panel2)!important;color:var(--ink)!important;border-color:var(--line2)!important}
.hx-btn:hover{border-color:var(--teal)}.hx-btn:disabled{opacity:.45;cursor:default}
.hx-btn.pri{border-color:var(--teal)!important;color:var(--teal2)!important;background:var(--tealdim)!important}
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
.hx-cells{display:grid;grid-template-columns:repeat(auto-fill,minmax(14px,1fr));gap:3px}
.hx-cells i{height:12px;border-radius:2px;background:var(--line2);cursor:pointer}
.hx-cells i.o{background:var(--ok)}.hx-cells i.r{background:var(--teal)}.hx-cells i.w{background:var(--warn)}
.hx-bigs{display:flex;gap:22px;margin:4px 0 8px;flex-wrap:wrap}.hx-bigs div small{display:block;color:var(--ink3);font-size:11px}.hx-bigs div .hx-num{font-size:24px;font-weight:700}
.hx-bars{display:grid;grid-template-columns:auto 1fr auto;gap:4px 10px;align-items:center;font-size:11.5px}
.hx-bars .track{height:8px;background:var(--line);border-radius:3px;overflow:hidden}.hx-bars .track span{display:block;height:100%;background:var(--fire1)}
.hx-list{display:flex;flex-direction:column;gap:1px}
.hx-li{padding:5px 8px;border-radius:5px;cursor:pointer;display:flex;justify-content:space-between;gap:8px}
.hx-li:hover{background:var(--panel2)}.hx-li.on{background:var(--panel3);box-shadow:inset 3px 0 0 var(--teal)}
.hx-json{white-space:pre-wrap;word-break:break-all;font-family:var(--mono);font-size:11.5px;line-height:1.55;color:var(--ink)}
.hx-json .k{color:var(--teal)}.hx-json .s{color:color-mix(in srgb,var(--warn) 80%,var(--ink))}.hx-json .n{color:color-mix(in srgb,var(--ok) 70%,var(--ink))}
.hx-text{white-space:pre-wrap;font-size:13px;line-height:1.8;border:1px solid var(--line2);border-radius:6px;padding:8px 10px;background:var(--panel2);margin-bottom:8px}
.hx-md{white-space:pre-wrap;font-family:var(--mono);font-size:12px;line-height:1.6}
.hx-kv{display:grid;grid-template-columns:auto 1fr;gap:3px 12px;font-size:11.5px}
.hx-ov{flex:1;min-height:0;display:flex;gap:8px}
.hx-ov-stage{flex:1;min-width:0;display:flex;flex-direction:column;padding:10px 14px 8px}
.hx-ov-head{display:flex;align-items:baseline;gap:10px;flex:none}.hx-ov-head b{font-size:13px;letter-spacing:1px}
.hx-steps{display:flex;gap:4px;margin-left:auto;font-size:11px}
.hx-steps span{padding:2px 8px;border-radius:10px;border:1px solid var(--line);color:var(--ink3)}
.hx-steps .done{color:var(--ok);border-color:color-mix(in srgb,var(--ok) 45%,transparent)}
.hx-steps .warn{color:var(--warn);border-color:color-mix(in srgb,var(--warn) 50%,transparent)}
.hx-steps .run{color:var(--fire1);border-color:var(--fire1);background:var(--fireDim)}
.hx-steps .bad{color:var(--bad);border-color:color-mix(in srgb,var(--bad) 50%,transparent)}
.hx-flow{flex:1;min-height:0;width:100%;margin-top:4px}
.hx-flow text{font-family:inherit}
.hx-t-strong{font-size:12.5px;font-weight:600;fill:var(--ink)}.hx-t-sub{font-size:11px;fill:var(--ink3)}.hx-t-cap{font-size:11px;fill:var(--ink3);letter-spacing:1px}
.hx-t-name{font-size:12px;fill:var(--ink)}.hx-t-num{font-size:11px;fill:var(--ink2);font-family:var(--mono)}
.hx-t-warn{font-size:11px;fill:var(--warn)}.hx-t-vio{font-size:10.5px;fill:var(--vio)}
.hx-gate{cursor:pointer}.hx-gate:hover .hx-gate-band{stroke-opacity:.6}
.hx-empty-card{fill:var(--panel2);stroke:var(--line);stroke-dasharray:4 4}
.hx-shadow{fill:#000;opacity:.42;filter:url(#hx-soft)}.hx-light .hx-shadow{opacity:.12}
.hx-slab-top{fill:color-mix(in srgb,var(--panel2) 70%,var(--ink) 12%)}.hx-slab-side{fill:color-mix(in srgb,var(--panel2) 75%,#000 25%)}
.hx-light .hx-slab-top{fill:color-mix(in srgb,var(--panel2) 80%,#fff 20%)}.hx-light .hx-slab-side{fill:color-mix(in srgb,var(--panel2) 82%,#5a4030 18%)}
.hx-glass-top{fill:var(--ink2);fill-opacity:.2}.hx-glass-side{fill:var(--ink2);fill-opacity:.1}
.hx-gate-band{fill:var(--ink2);fill-opacity:.06;stroke:var(--ink2);stroke-opacity:.3}
.hx-link-shadow{fill:none;stroke:#000;stroke-opacity:.5;filter:url(#hx-soft)}.hx-light .hx-link-shadow{stroke-opacity:.13}
.hx-link-hi{fill:none;stroke:#fff;stroke-opacity:.22;pointer-events:none}.hx-light .hx-link-hi{stroke-opacity:.35}
.hx-col-pad{fill:var(--track)}.hx-col-pad.zero{fill:url(#hx-stripe);stroke:var(--warn);stroke-width:.8}
.hx-col-front{fill:color-mix(in srgb,var(--fire1) 78%,#000)}.hx-col-front.full{fill:var(--fire1)}
.hx-col-side{fill:color-mix(in srgb,var(--fire1) 50%,#000)}.hx-col-side.full{fill:color-mix(in srgb,var(--fire1) 62%,#000)}
.hx-col-top{fill:color-mix(in srgb,var(--fire1) 70%,#fff 10%)}.hx-col-top.full{fill:color-mix(in srgb,var(--fire1) 60%,#ffd2a8)}
.hx-cube .front{fill:var(--neutral)}.hx-cube .top{fill:color-mix(in srgb,var(--neutral) 70%,#fff)}.hx-cube .side{fill:color-mix(in srgb,var(--neutral) 65%,#000)}
.hx-cube.w .front{fill:url(#hx-stripe);stroke:var(--warn);stroke-width:.5}.hx-cube.w .top{fill:var(--warn)}.hx-cube.w .side{fill:color-mix(in srgb,var(--warn) 60%,#000)}

.hx-link{fill:none;stroke:url(#hx-fl);stroke-opacity:.82;mix-blend-mode:normal}
.hx-dark .hx-link{filter:drop-shadow(0 0 2px color-mix(in srgb,var(--fire1) 35%,transparent))}
.hx-link.bin{stroke:var(--neutral);stroke-dasharray:4 4;filter:none}
.hx-link.run{stroke-dasharray:14 8;animation:hx-flowing 1.1s linear infinite}
@keyframes hx-flowing{to{stroke-dashoffset:-22}}
.hx-pile{fill:var(--neutral);stroke:var(--ink3);stroke-width:.6}.hx-pile.w{fill:url(#hx-stripe);stroke:var(--warn)}
.hx-src{cursor:pointer}.hx-src-box{fill:var(--panel2);stroke:var(--line)}.hx-src:hover .hx-src-box{stroke:var(--line2)}
.hx-src-mark{fill:var(--neutral)}.hx-src-mark.vio{fill:var(--vio)}
.hx-box{cursor:pointer}.hx-box-r{fill:var(--panel2);stroke:var(--line)}.hx-box:hover .hx-box-r{stroke:var(--line2)}
.hx-box-mark{fill:var(--fire1)}.hx-box.empty .hx-box-r{fill:none;stroke-dasharray:4 3}.hx-box.empty .hx-box-mark{fill:var(--line)}.hx-box.empty .hx-t-strong{fill:var(--ink3)}
.hx-cell{fill:var(--track)}.hx-cell-fill{fill:var(--fire1);opacity:.62}.hx-cell-fill.full{opacity:1}
.hx-cell-empty{fill:none;stroke:var(--warn);stroke-dasharray:2 2;opacity:.85}
.hx-cell-v{font-size:9px;font-weight:600;font-family:var(--mono);fill:var(--ink2)}
.hx-cell-l{font-size:8.5px;fill:var(--ink3)}.hx-cell-l.warn{fill:var(--warn)}
.hx-ov-foot{flex:none;font-size:11px;text-align:right}
.hx-ov-side{width:300px;flex:none;display:flex;flex-direction:column;gap:2px}
.hx-now{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--fire1);padding:6px 8px;border:1px solid color-mix(in srgb,var(--fire1) 40%,transparent);border-radius:6px;background:var(--fireDim);margin-top:6px}
.hx-now i{width:7px;height:7px;border-radius:50%;background:var(--fire1);animation:hx-blink 1.2s infinite}
.hx-alert{display:flex;gap:8px;align-items:center;justify-content:space-between;border-left:3px solid var(--warn);padding:3px 0 3px 8px;margin:3px 0}
.hx-alert.b{border-left-color:var(--bad)}
.hx-alert-t{font-weight:600;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.hx-alert-s{font-size:11px;color:var(--ink2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.hx-tiles{display:grid;grid-template-columns:1fr 1fr;gap:6px}.hx-tiles>div{border:1px solid var(--line);border-radius:6px;padding:6px 10px;background:var(--panel2)}
.hx-tiles small{display:block;color:var(--ink3);font-size:11px}.hx-tiles b{font-size:20px}
.hx-stage-rows{display:flex;flex-direction:column;gap:2px}.hx-stage-rows>div{display:grid;grid-template-columns:92px 1fr auto;gap:8px;align-items:center;font-size:12px;padding:4px 6px;border-radius:5px;cursor:pointer}
.hx-stage-rows>div:hover,.hx-hole:hover{background:var(--panel2)}
.hx-hole{display:flex;justify-content:space-between;font-size:12px;padding:3px 6px;border-radius:5px;cursor:pointer;color:var(--ink2)}
.hx-kv-tight{gap:4px 10px;font-size:11.5px}.hx-kv-tight span:nth-child(2n){white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.hx-legend2{display:flex;flex-wrap:wrap;gap:5px 12px;font-size:11px;color:var(--ink2)}
.hx-legend2 i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:4px;vertical-align:-1px}
.c-fire{background:linear-gradient(90deg,var(--fire1),var(--fire2))}.c-neutral{background:var(--neutral)}.c-ok{background:var(--ok)}.c-warn{background:var(--warn)}.c-bad{background:var(--bad)}.c-vio{background:var(--vio)}
.hx-vio{color:var(--vio)}
@keyframes hx-blink{0%,100%{opacity:.95}50%{opacity:.35}}
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
    function clock(ms) { const s2 = Math.max(0, Math.floor(Number(ms || 0) / 1000)); const p = (v) => String(v).padStart(2, '0'); return `${p(Math.floor(s2 / 3600))}:${p(Math.floor(s2 / 60) % 60)}:${p(s2 % 60)}` }
    const FLAME_PATH = 'M9 1c1 4 6 6 6 11a6 6 0 0 1-12 0c0-3 2-4 3-6 0 2 1 3 2 3-1-3 0-6 1-8z'
    const byOrder = (a, b) => (TYPE_ORDER.indexOf(a) + 1 || 99) - (TYPE_ORDER.indexOf(b) + 1 || 99)
    const shortTime = (s) => (s ? String(s).replace('T', ' ').replace(/:\d{2}([+-]\d{2}:\d{2}|Z)$/, '').replace(/([+-]\d{2}:\d{2}|Z)$/, '') : '—')

    function Icon({ size = 16 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' },
        h('path', { d: 'M12 2.5c1.2 4.6 6.5 6.6 6.5 12a6.5 6.5 0 0 1-13 0c0-3.4 2.1-4.7 3.2-6.8.2 2.2 1.1 3.4 2.3 3.6-.9-3.4.1-6.6 1-8.8z' }), h('path', { d: 'M12 21c-1.8 0-3-1.3-3-3 0-1.9 1.6-2.6 2.2-4 .5 1.3 1.1 1.6 1.7 1.8 1 .4 2.1 1 2.1 2.4 0 1.6-1.2 2.8-3 2.8z' }))
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
      const [activeId, setActiveId] = useState(null)
      const [showNew, setShowNew] = useState(false)
      const [runsOpen, setRunsOpen] = useState(false)
      const [settingsOpen, setSettingsOpen] = useState(false)
      const [deleting, setDeleting] = useState(null)
      const [config, setConfig] = useState(null)
      const [now, setNow] = useState(Date.now())
      const rootRef = useRef(null)
      useEffect(() => { call('config').then(setConfig).catch(() => {}) }, [])
      const dark = useHostDark(rootRef)

      const refreshList = useCallback(async () => {
        try {
          const v = await call('list')
          setRuns(v.runs)
          setRunId((cur) => cur ?? v.active ?? v.runs[0]?.id ?? null)
          if (!v.runs.length) setShowNew(true)
          setActiveId(v.active ?? null)
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
      const running = run?.status === 'running'
      const anyRunning = Boolean(activeId) && activeId !== run?.id
      const lineStatus = run ? run.status : 'idle'
      const resumable = run && ['cancelled', 'failed'].includes(run.status) && !activeId
      useEffect(() => { if (!running) return undefined; const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id) }, [running])
      const startedMs = run?.startedAt ? Date.parse(run.startedAt) : 0
      const elapsed = !run ? 0 : running ? now - startedMs : (run.finishedAt ? Date.parse(run.finishedAt) - startedMs : 0)
      const percent = !run ? 0 : run.status === 'completed' || run.status === 'review' ? 100 : t?.units ? Math.floor(((run.units?.length ?? 0) / t.units) * 100) : 0
      const SRC = { agent: 'Agent 会话', command: '/hl7 命令', panel: '页面', rerun: '重新运行' }
      const sourceLabel = (source) => {
        const label = source.kind === 'rerun' ? `重新运行 ${String(source.of ?? '').slice(-6)}` : SRC[source.kind] ?? source.kind
        if (!source.sessionId) return h('span', { className: 'hx-src' }, `来源：${label}`)
        return h('button', { type: 'button', className: 'hx-src link', title: source.sessionId, onClick: () => { try { services.ctx.get('uiWorkspace').openSession(source.sessionId) } catch (e) { setError(msg(e)) } } }, `来源：${label} ↗`)
      }
      const removeRun = async (id) => {
        setDeleting((d) => ({ ...d, busy: true, error: '' }))
        try {
          await call('deleteRun', { runId: id })
          setDeleting(null)
          if (id === runId) { setRunId(null); setRun(null) }
          const v = await call('list'); setRuns(v.runs); if (id === runId) setRunId(v.runs[0]?.id ?? null)
        } catch (e) { setDeleting((d) => ({ ...d, busy: false, error: msg(e) })) }
      }
      const runsPopover = () => h('div', { className: 'hx-pop runs', role: 'dialog' },
        h('div', { className: 'hx-pop-h' }, h('b', {}, '批次记录'), h('span', { className: 'hx-sp' }), h('button', { className: 'hx-btn sm', onClick: refreshList }, '刷新')),
        runs.length === 0 ? h('div', { className: 'hx-faint' }, '还没有批次') : h('div', { className: 'hx-runs' }, runs.map((r) => h('div', {
          key: r.id, role: 'button', tabIndex: 0, className: `hx-run${r.id === runId ? ' on' : ''}`,
          onClick: () => { setRunId(r.id); setRun(null); setPatient(null); setRunsOpen(false); setTab('overview') },
        },
          h('div', { className: 'hx-run-top' },
            h('span', { className: 'hx-run-name', title: r.outputRoot }, r.input ?? r.id),
            statusChip(r.status),
            r.status !== 'running' ? h('button', { type: 'button', className: 'hx-run-del', title: '删除批次记录', onClick: (e) => { e.stopPropagation(); setDeleting({ id: r.id, busy: false, error: '' }) } }, '✕') : null),
          h('div', { className: 'hx-run-meta' },
            h('span', {}, `${shortTime(r.startedAt)}${r.source ? ` · ${r.source.kind === 'rerun' ? '重新运行' : SRC[r.source.kind] ?? r.source.kind}` : ''}${r.model ? ` · 模型 ${r.model}` : ''}`),
            h('span', {}, `${fmt(r.patients ?? 0)} 位病人 · ${fmt(r.resources ?? 0)} 个资源${r.held ? ` · 暂扣 ${r.held}` : ''}`)),
          deleting?.id === r.id ? h('div', { className: 'hx-run-confirm', onClick: (e) => e.stopPropagation() },
            h('div', {}, '删除该批次的过程记录（统计、模型调用、报告、中间结果、暂扣的病人）？交付目录保留，不受影响。此操作不可撤销。'),
            deleting.error ? h('div', { className: 'hx-bad' }, deleting.error) : null,
            h('div', { style: { display: 'flex', gap: 6, marginTop: 6 } }, h('button', { className: 'hx-btn sm danger', disabled: deleting.busy, onClick: () => removeRun(r.id) }, deleting.busy ? '删除中…' : '删除'), h('button', { className: 'hx-btn sm', onClick: () => setDeleting(null) }, '取消'))) : null))))
      const rerun = () => call('rerun', { runId: run.id }).then((v) => { setRunId(v.runId); setRun(null); refreshList() }).catch((e) => setError(msg(e)))
      return h('div', { className: `hx ${dark ? 'hx-dark' : 'hx-light'}`, ref: rootRef },
        h('style', {}, CSS),
        h('header', { className: 'hx-frame hx-top' },
          h('div', { className: 'hx-brandbox' },
            h('div', { className: 'hx-logo' }, h('svg', { width: 15, height: 17, viewBox: '0 0 18 20' }, h('path', { d: FLAME_PATH, fill: '#fff' }))),
            h('div', { className: 'hx-brand' }, h('b', {}, TITLE), h('span', {}, 'HL7 FHIR R4 STANDARDIZATION'))),
          h('div', { className: `hx-status s-${lineStatus}` },
            h('span', { className: 'hx-lamp' }),
            h('div', {},
              h('b', {}, lineStatus === 'idle' ? '空闲' : STATUS[lineStatus]?.[0] ?? lineStatus),
              h('span', { className: 'hx-num' }, run?.id ?? '—'),
              run?.source ? sourceLabel(run.source) : null)),
          running && run?.current ? h('div', { className: 'hx-now-top', title: `${run.current.unit} · ${run.current.step}` }, `${run.current.unit} · ${run.current.step}`) : null,
          h('span', { className: 'hx-sp' }),
          h('div', { className: 'hx-clock sep' }, h('span', {}, '用时'), h('b', {}, clock(elapsed))),
          run ? h('div', { className: 'hx-clock sep', title: `${fmt(run.units?.length ?? 0)} / ${fmt(t?.units ?? 0)} 个目录` }, h('span', {}, '完成'), h('b', { className: 'hx-pct' }, String(percent), h('small', {}, '%'))) : null,
          config?.version ? h('div', { className: 'hx-clock ver' }, h('span', {}, '版本'), h('b', {}, `v${config.version}`)) : null,
          h('div', { className: 'hx-act' },
            running
              ? h('button', { className: 'hx-btn stop', onClick: () => call('cancel', { runId: run.id }).catch((e) => setError(msg(e))) }, '■ 取消批次')
              : h('button', { className: 'hx-btn new', disabled: anyRunning, onClick: () => { setShowNew((x) => !x); setRunsOpen(false) } }, anyRunning ? '有批次在运行' : h(React.Fragment, {}, '＋ 新批次', h('span', { className: 'hx-caret' }, '▾'))),
            !running && showNew ? h('div', { className: 'hx-shade', onMouseDown: () => setShowNew(false) }) : null,
            !running && showNew ? h('div', { className: 'hx-pop', role: 'dialog' },
              h('div', { className: 'hx-pop-h' }, h('b', {}, '新批次')),
              h(NewRun, { onStarted: (id) => { setShowNew(false); setRunId(id); setRun(null); setPatient(null); refreshList(); setTab('overview') }, onError: setError }),
              run && resumable ? h('button', { className: 'hx-btn', onClick: () => call('start', { resumeFrom: run.id }).then(() => { setShowNew(false); setRun(null); setRunId(null); setTimeout(() => setRunId(run.id), 0); refreshList() }).catch((e) => setError(msg(e))), title: '沿用原输入和输出根目录，已完成的病人和模型调用直接复用' }, `↻ 继续处理 ${run.id.slice(-6)}`) : null) : null),
          h('div', { className: 'hx-act' },
            h('button', { className: `hx-btn hbtn${runsOpen ? ' on' : ''}`, onClick: () => { setRunsOpen((x) => !x); setShowNew(false); if (!runsOpen) refreshList() }, title: '切换批次：查看、删除历史批次', 'aria-expanded': runsOpen ? 'true' : 'false' }, '记录', runs.length ? h('i', { className: 'hx-hcount' }, String(runs.length)) : null),
            runsOpen ? h('div', { className: 'hx-shade', onMouseDown: () => { setRunsOpen(false); setDeleting(null) } }) : null,
            runsOpen ? runsPopover() : null),
          h('button', { className: 'hx-btn hicon', title: '设置', 'aria-label': '设置', onClick: () => setSettingsOpen(true) }, '⚙')),
        h('div', { className: 'hx-frame hx-tabs' }, tabs.map(([k, label, n]) => h('button', { key: k, className: `hx-tab${tab === k ? ' on' : ''}`, onClick: () => setTab(k) }, label, n ? h('i', {}, String(n)) : null))),
        error ? h('div', { className: 'hx-err', onClick: () => setError('') }, error, h('span', { className: 'hx-faint' }, '（点击关闭）')) : null,
        settingsOpen ? h('div', { className: 'hx-modal', onMouseDown: (e) => { if (e.target === e.currentTarget) setSettingsOpen(false) } },
          h('div', { className: 'hx-modal-box' },
            h('div', { className: 'hx-pop-h' }, h('b', {}, `设置 · ${TITLE}`), h('span', { className: 'hx-sp' }), h('button', { className: 'hx-btn sm', onClick: () => setSettingsOpen(false) }, '关闭')),
            h('div', { className: 'hx-scroll', style: { flex: 1 } }, h(SettingsSection)))) : null,
        h('div', { className: 'hx-body' },
          !run ? h('div', { className: 'hx-frame hx-empty', style: { flex: 1 } }, runs.length ? '加载中…' : '还没有批次。点右上角「＋ 新批次」，选择匿名化后的数据目录开始转换。')
            : tab === 'overview' ? h(Overview, { run, openPatient, onTab: setTab })
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
      const [picking, setPicking] = useState('')
      // 先用系统对话框（macOS，由插件服务端弹出）；不行再用宿主的目录选择器
      const pick = async (kind) => {
        setPicking(kind)
        try {
          const v = await call(kind === 'file' ? 'pickFile' : 'pickFolder')
          if (v.path) setInput(v.path)
        } catch (cause) {
          try {
            const ws = services.ctx?.get('uiWorkspace')
            if (kind === 'file' || !ws?.pickDirectory) throw cause
            const picked = await ws.pickDirectory()
            if (picked) setInput(picked)
          } catch (e) { onError(msg(e)) }
        } finally { setPicking('') }
      }
      const start = async () => {
        setBusy(true)
        try { const v = await call('start', { inputDir, outputRoot: outputRoot || undefined }); onStarted(v.runId) } catch (e) { onError(msg(e)) } finally { setBusy(false) }
      }
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
        h('label', { className: 'hx-field' }, '输入目录或文件（通常是匿名化插件的交付目录；json / ndjson / csv，字段命名不限）',
          h('div', { style: { display: 'flex', gap: 6 } }, h('input', { className: 'hx-input', style: { flex: 1 }, value: inputDir, onChange: (e) => setInput(e.target.value), placeholder: '/path/to/_medical-anonymizer/…' }), h('button', { className: 'hx-btn', disabled: Boolean(picking), onClick: () => pick('folder') }, picking === 'folder' ? '等待选择…' : '选择目录…'), h('button', { className: 'hx-btn', disabled: Boolean(picking), onClick: () => pick('file') }, picking === 'file' ? '等待选择…' : '选择文件…'))),
        h('label', { className: 'hx-field' }, '输出根目录（可空：输入旁的 _medical-hl7）', h('input', { className: 'hx-input', value: outputRoot, onChange: (e) => setOut(e.target.value) })),
        h('button', { className: 'hx-btn new', style: { alignSelf: 'stretch' }, disabled: !inputDir || busy, onClick: start }, busy ? '启动中…' : '▶ 开始转换'))
    }

    /* ------------------------------------------------- 映射总览（源数据 → FHIR 资源类型） */
    const BOXES = ['Patient', 'Encounter', 'Condition', 'Observation', 'DiagnosticReport', 'Specimen', 'Procedure', 'MedicationRequest', 'DocumentReference', 'ChargeItem']
    const KIND_ZH = { patient: '病人信息', address: '地址', encounter: '就诊登记', condition: '诊断', lab: '检验', imaging: '检查', procedure: '手术操作', document: '病历文书', observation: '体征与问卷', medication: '用药医嘱', charge: '费用', death: '死亡', generic: '其他（未映射）' }
    const pct = (x) => (x == null ? '—' : `${(x * 100).toFixed(x > 0 && x < 0.1 ? 1 : 0)}%`)

    function flowModel(run) {
      const F = run.flow
      const byType = {}
      for (const p of run.patients) for (const [k, n] of Object.entries(p.byType ?? {})) byType[k] = (byType[k] ?? 0) + n
      if (!F) return { byType, sources: [], links: [], slots: {}, names: {} }
      const tables = F.tables ?? {}
      const byTable = Object.keys(tables).length > 14
      const groupOf = (id) => (byTable ? KIND_ZH[tables[id]?.kind] ?? '其他' : tables[id]?.name ?? id)
      const link = new Map(); const src = new Map()
      for (const [k, n] of Object.entries(F.flows ?? {})) {
        const [id, type] = k.split('|')
        const g = groupOf(id)
        const to = BOXES.includes(type) ? type : '__left'
        link.set(`${g}|${to}`, (link.get(`${g}|${to}`) ?? 0) + n)
        const s = src.get(g) ?? { name: g, n: 0, tables: new Set(), drafted: false }
        s.n += n; s.tables.add(tables[id]?.name ?? id); if (tables[id]?.drafted) s.drafted = true
        src.set(g, s)
      }
      return {
        byType, sources: [...src.values()].sort((a, b) => b.n - a.n), grouped: byTable,
        links: [...link].map(([k, n]) => { const [from, to] = k.split('|'); return { from, to, n } }).sort((a, b) => b.n - a.n),
        slots: F.slots ?? {}, names: F.slotNames ?? {},
      }
    }

    function FlowView({ run, onTab }) {
      const M = flowModel(run)
      const S = run.stages
      const running = run.status === 'running'
      const W = 1100
      const sx = 10, sw = 170, bx = 690, bw = 390, bH = 52, bGap = 9, top = 46
      const gx = [320, 445, 570]
      // sources
      const sH = (n) => Math.max(20, Math.min(120, Math.sqrt(n) * 0.85))
      let y = top; const sPos = new Map()
      for (const s of M.sources) { const hh = sH(s.n); sPos.set(s.name, { y, h: hh, used: 0, s }); y += hh + 9 }
      const bPos = new Map(); BOXES.forEach((t, i) => bPos.set(t, { y: top + i * (bH + bGap), used: 0 }))
      const binY = top + BOXES.length * (bH + bGap) + 2
      const H = Math.max(y, binY + 34) + 70
      const max = Math.max(1, ...M.links.map((l) => l.n))
      const lw = (n) => Math.max(1.2, Math.sqrt(n / max) * 26)
      const pile = (S ? S.domains.pending + S.domains.unmapped : 0)
      const unmappedConcepts = S ? S.terminology.concepts - S.terminology.mappedConcepts : 0
      const MP = run.model?.phases
      const gates = [
        { x: gx[0], no: '①', name: 'Schema 同构', tab: 'schema', sub: S ? `${S.schema.tables} 张表${S.schema.inferred ? ` · Basic ${S.schema.inferred}` : ''}` : '—', pile: S?.schema.inferred ?? 0, pileLabel: '无映射规格', warn: true, model: MP?.schema?.tables ? `模型起草 ${MP.schema.tables}` : null },
        { x: gx[1], no: '②', name: '值域归一', tab: 'domains', sub: S ? `覆盖 ${pct(S.domains.coverage)}` : '—', pile, pileLabel: '待确认', warn: true, model: MP?.values?.asked ? `模型采用 ${MP.values.confirmed + MP.values.text + MP.values.invalid}` : null },
        { x: gx[2], no: '③', name: '术语对照', tab: 'terms', sub: S ? `${fmt(S.terminology.mappedConcepts)} / ${fmt(S.terminology.concepts)} 概念` : '—', pile: unmappedConcepts, pileLabel: '未对照', warn: false, model: MP?.terms?.asked ? `模型采用 ${MP.terms.confirmed}` : null },
      ]
      const key = { k: 0 }
      const K = () => key.k++
      const parts = []
      // 2.5D：斜投影的厚度（右上方向）
      const DX = 9, DY = 7
      const P2 = (l) => l.map((q) => `${q[0].toFixed(1)},${q[1].toFixed(1)}`).join(' ')
      const slab = (x, y, w, hh, cls, k) => [
        h('rect', { key: `${k}s`, x: x + 6, y: y + 8, width: w, height: hh, rx: 5, className: 'hx-shadow' }),
        h('polygon', { key: `${k}t`, points: P2([[x + 2, y], [x + w, y], [x + w + DX, y - DY], [x + 2 + DX, y - DY]]), className: `${cls}-top` }),
        h('polygon', { key: `${k}r`, points: P2([[x + w, y], [x + w + DX, y - DY], [x + w + DX, y + hh - DY - 2], [x + w, y + hh]]), className: `${cls}-side` }),
      ]
      const column = (x, base, w, hh, full, k) => [
        h('polygon', { key: `${k}r`, points: P2([[x + w, base], [x + w + 6, base - 5], [x + w + 6, base - hh - 5], [x + w, base - hh]]), className: full ? 'hx-col-side full' : 'hx-col-side' }),
        h('polygon', { key: `${k}t`, points: P2([[x, base - hh], [x + w, base - hh], [x + w + 6, base - hh - 5], [x + 6, base - hh - 5]]), className: full ? 'hx-col-top full' : 'hx-col-top' }),
        h('rect', { key: `${k}f`, x, y: base - hh, width: w, height: hh, className: full ? 'hx-col-front full' : 'hx-col-front' }),
      ]
      const pad = (x, base, w, cls, k) => h('polygon', { key: k, points: P2([[x, base], [x + w, base], [x + w + 6, base - 5], [x + 6, base - 5]]), className: cls })
      parts.push(h('defs', { key: 'd' },
        h('linearGradient', { id: 'hx-fl', gradientUnits: 'userSpaceOnUse', x1: sx + sw, x2: bx, y1: 0, y2: 0 },
          h('stop', { offset: 0, style: { stopColor: 'var(--neutral)' } }), h('stop', { offset: (gx[0] - sx - sw) / (bx - sx - sw), style: { stopColor: 'var(--neutral)' } }),
          h('stop', { offset: (gx[0] + 30 - sx - sw) / (bx - sx - sw), style: { stopColor: 'var(--fire1)' } }), h('stop', { offset: 1, style: { stopColor: 'var(--fire2)' } })),
        h('filter', { id: 'hx-soft', x: '-30%', y: '-30%', width: '160%', height: '160%' }, h('feGaussianBlur', { stdDeviation: 6 })),
        h('pattern', { id: 'hx-stripe', width: 5, height: 5, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, h('rect', { width: 5, height: 5, style: { fill: 'var(--warn)' }, opacity: 0.25 }), h('rect', { width: 2, height: 5, style: { fill: 'var(--warn)' } }))))
      const noData = !M.sources.length
      // gates
      for (const g of noData ? [] : gates) {
        parts.push(h('g', { key: K(), className: 'hx-gate', onClick: () => onTab(g.tab) }, h('title', {}, `${g.name}：点击查看详情`),
          h('polygon', { points: P2([[g.x - 15, top - 8], [g.x + 17, top - 8], [g.x + 17 + DX * 2, top - 8 - DY * 2], [g.x - 15 + DX * 2, top - 8 - DY * 2]]), className: 'hx-glass-top' }),
          h('polygon', { points: P2([[g.x + 17, top - 8], [g.x + 17 + DX * 2, top - 8 - DY * 2], [g.x + 17 + DX * 2, H - 62 - DY * 2], [g.x + 17, H - 62]]), className: 'hx-glass-side' }),
          h('rect', { x: g.x - 17, y: top - 8, width: 34, height: H - top - 54, rx: 6, className: 'hx-gate-band' }),
          h('text', { x: g.x + 8, y: top - 26, textAnchor: 'middle', className: 'hx-t-strong' }, `${g.no} ${g.name}`),
          h('text', { x: g.x, y: H - 30, textAnchor: 'middle', className: 'hx-t-sub' }, g.sub),
          g.model ? h('text', { x: g.x, y: H - 15, textAnchor: 'middle', className: 'hx-t-vio' }, `◆ ${g.model}`) : null))
      }
      // links
      for (const l of M.links) {
        const s = sPos.get(l.from); if (!s) continue
        const toBin = l.to === '__left'
        const b = toBin ? { y: binY - 8, used: 0 } : bPos.get(l.to)
        const w = lw(l.n)
        const y1 = s.y + Math.min(s.h - 2, s.used + w / 2); s.used += w * 0.62
        const y2 = toBin ? binY + 15 : b.y + 14 + Math.min(bH - 18, b.used + w / 2); if (!toBin) b.used += w * 0.5
        const x1 = sx + sw, x2 = bx
        const d = `M${x1},${y1} C${x1 + 210},${y1} ${x2 - 210},${y2} ${x2},${y2}`
        const sw2 = toBin ? Math.min(w, 6) : w
        if (!toBin) parts.push(h('path', { key: K(), d, className: 'hx-link-shadow', strokeWidth: sw2, transform: 'translate(5,7)' }))
        parts.push(h('path', { key: K(), d, className: `hx-link${toBin ? ' bin' : ''}${running ? ' run' : ''}`, strokeWidth: sw2 }, h('title', {}, `${l.from} → ${toBin ? '未映射（Basic / source-field）' : `${l.to} ${TYPE_ZH[l.to] ?? ''}`}：${fmt(l.n)}`)))
        if (!toBin && w > 4) parts.push(h('path', { key: K(), d, className: 'hx-link-hi', strokeWidth: Math.max(1, w * 0.18), transform: `translate(0,${(-w * 0.28).toFixed(1)})` }))
      }
      // piles
      for (const g of noData ? [] : gates) {
        if (!g.pile) continue
        const n = Math.min(12, Math.max(1, Math.ceil(Math.log10(g.pile + 1) * 3)))
        const items = []
        for (let i = 0; i < n; i++) {
          const x = g.x - 14 + (i % 3) * 10, y0 = H - 78 - Math.floor(i / 3) * 10, s2 = 7.5
          items.push(h('g', { key: i, className: g.warn ? 'hx-cube w' : 'hx-cube' },
            h('polygon', { points: P2([[x, y0], [x + s2, y0], [x + s2 + 3, y0 - 3], [x + 3, y0 - 3]]), className: 'top' }),
            h('polygon', { points: P2([[x + s2, y0], [x + s2 + 3, y0 - 3], [x + s2 + 3, y0 + s2 - 3], [x + s2, y0 + s2]]), className: 'side' }),
            h('rect', { x, y: y0, width: s2, height: s2, className: 'front' })))
        }
        parts.push(h('g', { key: K(), className: 'hx-gate', onClick: () => onTab(g.tab) }, items, h('text', { x: g.x + 20, y: H - 62, className: g.warn ? 'hx-t-warn' : 'hx-t-sub' }, `${g.pileLabel} ${fmt(g.pile)}`)))
      }
      // sources
      if (!noData) parts.push(h('text', { key: K(), x: sx, y: top - 22, className: 'hx-t-cap' }, `源数据 · ${M.sources.length} ${M.grouped ? '类（按记录类别合并）' : '张表'}`))
      for (const [name, p] of sPos) {
        parts.push(h('g', { key: K(), className: 'hx-src', onClick: () => onTab('schema') }, h('title', {}, `${name}：${fmt(p.s.n)} 个资源${M.grouped ? `\n${[...p.s.tables].slice(0, 12).join('、')}${p.s.tables.size > 12 ? '…' : ''}` : ''}${p.s.drafted ? '\n含模型起草的映射规格' : ''}`),
          slab(sx, p.y, sw, p.h, 'hx-slab', 'a'),
          h('rect', { x: sx, y: p.y, width: sw, height: p.h, rx: 3, className: 'hx-src-box' }),
          h('rect', { x: sx, y: p.y, width: 3, height: p.h, rx: 1.5, className: p.s.drafted ? 'hx-src-mark vio' : 'hx-src-mark' }),
          h('text', { x: sx + 10, y: p.y + Math.min(p.h / 2 + 4, 15), className: 'hx-t-name' }, name.length > 9 ? `${name.slice(0, 9)}…` : name),
          h('text', { x: sx + sw - 8, y: p.y + Math.min(p.h / 2 + 4, 15), textAnchor: 'end', className: 'hx-t-num' }, fmt(p.s.n))))
      }
      if (noData) {
        const cx = (sx + bx) / 2 - 20, cy = top + 200
        parts.push(h('g', { key: K() },
          h('rect', { x: cx - 210, y: cy - 46, width: 420, height: 92, rx: 10, className: 'hx-empty-card' }),
          h('text', { x: cx, y: cy - 8, textAnchor: 'middle', className: 'hx-t-strong' }, running ? '正在读取和整理数据…' : '该批次暂无映射统计'),
          h('text', { x: cx, y: cy + 16, textAnchor: 'middle', className: 'hx-t-sub' }, running ? '第一位病人转换完成后，在此显示映射情况' : '交付的 Bundle 已移动或删除，重新运行该批次后可查看')))
      }
      // boxes
      parts.push(h('text', { key: K(), x: bx, y: top - 22, className: 'hx-t-cap' }, 'FHIR R4 资源类型（柱高 = 元素填充率）'))
      for (const t of BOXES) {
        const b = bPos.get(t); const n = M.byType[t] ?? 0; const empty = !n
        const st = M.slots[t]; const names = M.names[t] ?? []
        const cells = names.map((nm, i) => ({ nm, rate: st && st.n ? (st.v[i] ?? 0) / st.n : null }))
        const cx0 = bx + 160
        parts.push(h('g', { key: K(), className: `hx-box${empty ? ' empty' : ''}`, onClick: () => onTab('resources') }, h('title', {}, `${t}（${TYPE_ZH[t]}）：${empty ? (noData ? '—' : '本批没有') : fmt(n)}`),
          empty ? null : slab(bx, b.y, bw, bH, 'hx-slab', 'b'),
          h('rect', { x: bx, y: b.y, width: bw, height: bH, rx: 3, className: 'hx-box-r' }),
          h('rect', { x: bx, y: b.y, width: 4, height: bH, className: 'hx-box-mark' }),
          h('text', { x: bx + 12, y: b.y + 18, className: 'hx-t-strong' }, t),
          h('text', { x: bx + 12, y: b.y + 34, className: 'hx-t-sub' }, TYPE_ZH[t]),
          h('text', { x: bx + 12, y: b.y + 47, className: empty ? 'hx-t-sub' : 'hx-t-num' }, empty ? (noData ? (running ? '等待中' : '—') : '本批没有') : fmt(n)),
          cells.map((c, i) => {
            const cw2 = 24, x = cx0 + i * 37, base = b.y + bH - 10, maxH = 30
            const zero = !empty && c.rate === 0
            const hh = c.rate ? 3 + c.rate * maxH : 0
            return h('g', { key: i }, h('title', {}, `${c.nm}：${c.rate == null ? '—' : `${pct(c.rate)}（${fmt(st.v[i])} / ${fmt(st.n)}）`}`),
              pad(x, base, cw2, zero ? 'hx-col-pad zero' : 'hx-col-pad', 'p'),
              hh ? column(x, base, cw2, hh, c.rate >= 0.9, 'c') : null,
              !empty && c.rate != null && !zero ? h('text', { x: x + cw2 / 2 + 3, y: base - hh - 8, textAnchor: 'middle', className: 'hx-cell-v' }, Math.round(c.rate * 100)) : null,
              h('text', { x: x + cw2 / 2 + 3, y: base + 9, textAnchor: 'middle', className: zero ? 'hx-cell-l warn' : 'hx-cell-l' }, c.nm))
          })))
      }
      const leftover = run.patients.reduce((n, p) => n + (p.leftover ?? 0), 0)
      const refs = ['Organization', 'Practitioner'].filter((t) => M.byType[t]).map((t) => `${TYPE_ZH[t]} ${fmt(M.byType[t])}`).join(' · ')
      parts.push(h('g', { key: K(), className: 'hx-box empty', onClick: () => onTab('schema') }, h('title', {}, '未映射到 FHIR 元素的源字段以 source-field 扩展保留；无映射规格的表以 Basic 资源保存'),
        h('rect', { x: bx, y: binY, width: bw, height: 30, rx: 6, className: 'hx-box-r' }),
        h('text', { x: bx + 12, y: binY + 19, className: 'hx-t-sub' }, `未映射：${fmt(leftover)} 个字段值保留在 source-field 扩展 · ${fmt(M.byType.Basic ?? 0)} 条记录以 Basic 资源保存`)))
      if (refs) parts.push(h('text', { key: K(), x: bx, y: binY + 48, className: 'hx-t-sub' }, `引用资源：${refs}`))
      return h('svg', { className: 'hx-flow', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'xMidYMid meet', role: 'img', 'aria-label': '映射总览' }, parts)
    }

    function stepStates(run) {
      const running = run.status === 'running'
      const S = run.stages
      const cur = run.current?.step ?? ''
      const order = ['read', 'schema', 'domains', 'terms', 'build', 'gate', 'deliver']
      const out = {}
      if (running) {
        const at = run.current?.unit === '模型' ? (cur.startsWith('①') ? 'schema' : cur.startsWith('②') ? 'domains' : cur.startsWith('③') ? 'terms' : 'schema') : 'build'
        for (const k of order) out[k] = order.indexOf(k) < order.indexOf(at) ? 'done' : k === at ? 'run' : 'idle'
        return out
      }
      for (const k of order) out[k] = 'done'
      if (S?.schema.inferred || run.model?.phases?.schema?.review) out.schema = 'warn'
      if (S && S.domains.pending + S.domains.unmapped) out.domains = 'warn'
      if (run.totals.held) out.gate = 'warn'
      if (!run.output) out.deliver = ['failed', 'cancelled'].includes(run.status) ? 'bad' : 'idle'
      return out
    }

    /* --------------------------------------------------------------- overview */
    function Overview({ run, openPatient, onTab }) {
      const P = run.patients
      const t = run.totals
      const running = run.status === 'running'
      const S = run.stages
      const M = flowModel(run)
      const warns = [...new Set(run.warnings ?? [])]
      const lowCov = warns.filter((w) => w.startsWith('值域「'))
      const others = warns.filter((w) => !w.startsWith('值域「'))
      const pend = S ? S.domains.pending + S.domains.unmapped : 0
      const alerts = [
        run.error && { tone: 'b', title: '批次出错', sub: String(run.error).split('\n')[0], go: 'report', btn: '报告' },
        t.held && { tone: 'w', title: `暂扣 ${t.held} 位病人`, sub: '未通过验收，未交付', go: 'patients', btn: '病人' },
        pend && { tone: 'w', title: `值域待处理 ${fmt(pend)} 个取值`, sub: lowCov.length ? `${lowCov.length} 个值域覆盖率低于阈值（不阻断交付）` : '按原值交付', go: 'domains', btn: '复核' },
        run.model?.phases?.schema?.review && { tone: 'w', title: `模型起草的规格 ${run.model.phases.schema.review} 张存在未解决问题`, sub: '需人工审核后确认', go: 'schema', btn: '查看' },
        ...others.map((w) => ({ tone: 'w', title: w.length > 26 ? `${w.slice(0, 26)}…` : w, sub: w.length > 26 ? w : '', go: 'report', btn: '报告' })),
      ].filter(Boolean)
      const st = stepStates(run)
      const STEP = [['read', '读取'], ['schema', '①'], ['domains', '②'], ['terms', '③'], ['build', '④ 组装'], ['gate', '验收'], ['deliver', '交付']]
      const holes = []
      for (const [type, s] of Object.entries(M.slots)) (M.names[type] ?? []).forEach((nm, i) => { if (s.n) holes.push({ type, nm, rate: (s.v[i] ?? 0) / s.n, miss: s.n - (s.v[i] ?? 0) }) })
      const worst = holes.filter((x) => x.rate < 0.5).sort((a, b) => b.miss - a.miss).slice(0, 5)
      const kv = (k, v, cls = '') => [h('span', { key: `${k}k`, className: 'hx-faint' }, k), h('span', { key: `${k}v`, className: `hx-num ${cls}`, title: typeof v === 'string' ? v : undefined }, v)]
      return h('div', { className: 'hx-ov' },
        h('div', { className: 'hx-frame hx-ov-stage' },
          h('div', { className: 'hx-ov-head' }, h('b', {}, '映射总览'), h('span', { className: 'hx-cap' }, 'SOURCE → FHIR R4'),
            h('div', { className: 'hx-steps' }, STEP.map(([k, l]) => h('span', { key: k, className: st[k] }, `${l}${st[k] === 'done' ? ' ✓' : st[k] === 'warn' ? ' !' : st[k] === 'run' ? ' …' : ''}`)))),
          h(FlowView, { run, onTab }),
          h('div', { className: 'hx-ov-foot hx-faint' }, '线宽表示记录数 · 每列为一个 FHIR 元素的填充率（%），虚线表示填充率为 0 · 点击阶段或资源类型查看详情')),
        h('div', { className: 'hx-frame hx-pad hx-ov-side hx-scroll' },
          h('div', { className: 'hx-tiles' },
            [['病人', fmt(t.patients), ''], ['资源', fmt(t.resources), ''], ['暂扣', fmt(t.held), t.held ? 'hx-warn' : ''], ['结构错误', fmt(t.errors), t.errors ? 'hx-bad' : 'hx-ok']].map(([k, v, c]) => h('div', { key: k }, h('small', {}, k), h('b', { className: `hx-num ${c}` }, v)))),
          running && run.current ? h('div', { className: 'hx-now' }, h('i', {}), `${run.current.unit} · ${run.current.step}`) : null,
          alerts.length ? h(React.Fragment, {}, h('div', { className: 'hx-sec' }, h('b', {}, '待处理'), h('span', { className: 'hx-num hx-faint' }, alerts.length)),
            alerts.slice(0, 4).map((a, i) => h('div', { key: i, className: `hx-alert ${a.tone}`, title: a.sub || a.title },
              h('div', { style: { minWidth: 0 } }, h('div', { className: 'hx-alert-t' }, a.title), a.sub ? h('div', { className: 'hx-alert-s' }, a.sub) : null),
              h('button', { className: 'hx-btn sm', onClick: () => onTab(a.go) }, a.btn)))) : null,
          h('div', { className: 'hx-sec' }, h('b', {}, '处理阶段')),
          S ? h('div', { className: 'hx-stage-rows' },
            h('div', { onClick: () => onTab('schema') }, h('span', {}, '① Schema 同构'), h(Coverage, { value: S.schema.tables ? (S.schema.tables - S.schema.inferred) / S.schema.tables : null }), h('span', { className: 'hx-faint' }, `${S.schema.tables} 表`)),
            h('div', { onClick: () => onTab('domains') }, h('span', {}, '② 值域归一'), h(Coverage, { value: S.domains.coverage }), h('span', { className: pend ? 'hx-warn' : 'hx-faint' }, pend ? `待 ${fmt(pend)}` : '全部')),
            h('div', { onClick: () => onTab('terms') }, h('span', {}, '③ 术语对照'), h(Coverage, { value: S.terminology.coverage }), h('span', { className: 'hx-faint' }, `${fmt(S.terminology.mappedConcepts)}/${fmt(S.terminology.concepts)}`))) : h('div', { className: 'hx-faint' }, running ? '处理中…' : '—'),
          worst.length ? h(React.Fragment, {}, h('div', { className: 'hx-sec' }, h('b', {}, '填充率最低的元素')),
            worst.map((x, i) => h('div', { key: i, className: 'hx-hole', onClick: () => onTab(/标准|SNOMED/.test(x.nm) ? 'terms' : /解释/.test(x.nm) ? 'domains' : 'resources') }, h('span', {}, `${TYPE_ZH[x.type]} · ${x.nm}`), h('span', { className: 'hx-num hx-warn' }, pct(x.rate))))) : null,
          h('div', { className: 'hx-sec' }, h('b', {}, '病人'), h('span', { className: 'hx-faint' }, `交付 ${fmt(t.done)} · 暂扣 ${fmt(t.held)}`)),
          h('div', { className: 'hx-cells' }, P.slice(0, 300).map((p) => h('i', { key: p.name, title: `${p.name}：${p.status === 'held' ? '暂扣' : '交付'}，资源 ${p.resources}`, className: p.status === 'held' ? 'w' : 'o', onClick: () => openPatient(p.name) }))),
          h('div', { className: 'hx-sec' }, h('b', {}, '来源与交付')),
          h('div', { className: 'hx-kv hx-kv-tight' },
            ...kv('输入', run.input.split('/').slice(-2).join('/')),
            ...kv('来源', run.provenance?.kind === 'delivered' ? '匿名化正式交付' : run.provenance?.kind === 'withheld' ? '匿名化暂扣结果' : '未知来源', run.provenance?.kind === 'delivered' ? 'hx-ok' : 'hx-warn'),
            ...kv('模型', run.model?.configured ? `${run.model.models?.suggest ?? ''}${run.model.models?.verify ? ` / ${run.model.models.verify}` : ''}` : '未使用', run.model?.configured ? 'hx-vio' : 'hx-faint'),
            ...kv('交付', run.output ? run.output.split('/').slice(-2).join('/') : running ? '处理中' : '未交付'),
            ...kv('格式', { both: '按病人 + 按资源类型', bundles: '按病人', ndjson: '按资源类型' }[run.outputFormat ?? 'both']),
            ...kv('对照表', run.vocab?.version ?? '—')),
          h('div', { className: 'hx-sec' }, h('b', {}, '颜色')),
          h('div', { className: 'hx-legend2' }, [['fire', '已映射'], ['neutral', '未处理'], ['ok', '完成'], ['warn', '待确认'], ['bad', '错误'], ['vio', '模型']].map(([k, l]) => h('span', { key: k }, h('i', { className: `c-${k}` }), l)))))
    }

    /* --------------------------------------------------------------- patients */
    function Patients({ run, patient, setPatient, openPatient }) {
      const d = useAsync(() => (patient ? call('patient', { runId: run.id, patient }) : null), [run.id, patient, run.status])
      const p = d.value?.patient
      return h('div', { style: { display: 'flex', gap: 8, flex: 1, minHeight: 0 } },
        h('div', { className: 'hx-frame hx-scroll', style: { flex: 1.3 } },
          h('table', {},
            h('thead', {}, h('tr', {}, ['病人', '状态', '源记录', '资源', '结构错误', '残留标识符', '未登记就诊', '耗时'].map((x) => h('th', { key: x }, x)))),
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
    const DRAFT_ST = { applied: ['模型起草 · 未复核', 't'], review: ['模型起草 · 存在未解决问题', 'w'], confirmed: ['人工已确认', 'ok'], rejected: ['已驳回 · 按 Basic', 'b'], failed: ['起草失败', 'b'] }
    const draftLabel = (dr) => (dr.status === 'applied' ? (dr.agreement === 'disputed' ? ['模型起草 · 以复判结论为准', 'vio'] : ['模型起草 · 两个模型结论一致', 't']) : DRAFT_ST[dr.status] ?? [dr.status, ''])
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
            h('div', { className: 'hx-muted', style: { fontSize: 11.5, lineHeight: 1.6 } }, '表 → 记录类别，字段 → 语义角色。本阶段只做结构映射，不改变任何取值。无映射规格的表由模型起草（插件校验 + 独立盲审 + 复判）；未映射的字段以 source-field 扩展保留。'),
            d.value.model?.tables ? h('div', { className: 'hx-muted', style: { fontSize: 11.5, marginTop: 6 } }, `本批由模型起草 ${d.value.model.tables} 张：一致并采用 ${d.value.model.applied}、有分歧 ${d.value.model.review}、失败 ${d.value.model.failed}`) : null),
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
            dr.disputed?.length ? h('div', { className: 'hx-warn', style: { fontSize: 12, marginTop: 6 } }, `两个模型结论不一致、暂未映射的字段（以 source-field 保留）：${dr.disputed.join('、')}`) : null,
            dr.dropped?.length ? h('div', { className: 'hx-faint', style: { fontSize: 12, marginTop: 4 } }, `未通过插件校验而移除的角色：${dr.dropped.join('、')}`) : null,
            dr.links?.length ? h('div', { style: { fontSize: 12, marginTop: 4 } }, h('span', { className: 'hx-faint' }, '就诊号关联（经数据核对，已替换模型的选择）：'), dr.links.map((x, i) => h('div', { key: i, className: 'hx-num', style: { marginTop: 2 } }, `${x.role}：${x.previous ?? '—'} → ${x.field ?? '（移除）'}`, h('span', { className: 'hx-faint' }, `　${x.evidence}`)))) : null,
            dr.issue?.reason ? h('div', { className: 'hx-warn', style: { fontSize: 12, marginTop: 4 } }, `未解决的问题：${dr.issue.reason}`) : null,
            dr.dismissed?.length ? h('div', { style: { fontSize: 12, marginTop: 4 } }, h('span', { className: 'hx-faint' }, '核验模型提出、复判未采纳的意见（需人工审核）：'), dr.dismissed.map((x, i) => h('div', { key: i, style: { marginTop: 2 } }, h('span', { className: 'hx-warn' }, `R${x.round} ${x.reason}`), h('span', { className: 'hx-faint' }, ` ← 复判：${x.ruling}`)))) : null,
            h('details', { style: { marginTop: 6 } }, h('summary', { className: 'hx-faint', style: { fontSize: 12, cursor: 'pointer' } }, '起草过程'),
              (dr.trail ?? []).map((x, i) => h('div', { key: i, style: { fontSize: 11.5, marginTop: 3 } }, h('span', { className: 'hx-num hx-faint' }, `R${x.round} ${x.step}`), ' ', x.ok === true ? h('span', { className: 'hx-ok' }, '通过 ') : x.ok === false ? h('span', { className: 'hx-warn' }, '提出异议 ') : x.revise === true ? h('span', { className: 'hx-ok' }, '修正 ') : x.revise === false ? h('span', { className: 'hx-warn' }, '维持原结论 ') : null, x.reason ?? ''))),
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
          h('div', { className: 'hx-sec' }, h('b', {}, '原样保留的字段'), h('span', { className: 'hx-faint' }, 'source-field 扩展；出现较多的字段建议补充到映射规格')),
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
              h('div', { className: 'hx-muted', style: { fontSize: 11.5, lineHeight: 1.6 } }, '将同一含义的不同写法统一为规范值。原值始终保留；含义未经确认的取值标为“待确认”，不做推测。'),
              d.value.summary ? h('div', { className: 'hx-muted', style: { fontSize: 11.5, marginTop: 6 } }, `覆盖率 ${(d.value.summary.coverage * 100).toFixed(1)}% · 待确认 ${fmt(d.value.summary.pending)} · 无对照 ${fmt(d.value.summary.unmapped)} · 不属于/无法解析 ${fmt(d.value.summary.invalid)}`) : null),
            h('table', {}, h('thead', {}, h('tr', {}, ['值域', '取值', '覆盖率', ''].map((x, i) => h('th', { key: i }, x)))),
              h('tbody', {}, doms.map((x) => h('tr', { key: x.id, className: `click${x === dom ? ' sel' : ''}`, onClick: () => { setSel(x.id); setEdit(null) } },
                h('td', {}, x.name, h('div', { className: 'hx-faint hx-num', style: { fontSize: 10 } }, x.kind === 'enum' ? '对照' : '格式')),
                h('td', { className: 'hx-num' }, fmt(x.total)), h('td', { style: { width: 110 } }, h(Coverage, { value: x.coverage })),
                h('td', {}, (x.byStatus.pending ?? 0) + (x.byStatus.unmapped ?? 0) ? h('span', { className: 'hx-chip w' }, fmt((x.byStatus.pending ?? 0) + (x.byStatus.unmapped ?? 0))) : null, x.changed ? h('span', { className: 'hx-chip t' }, `已修改 ${x.changed}`) : null)))))),
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
              h('div', { className: 'hx-muted', style: { fontSize: 11.5, lineHeight: 1.6 } }, '本地概念 → 标准术语（LOINC、SNOMED CT、国家标准代码表）。不修改原值；已确认的对照另行添加标准编码，未对照的概念不影响交付。')),
            h('table', {}, h('thead', {}, h('tr', {}, ['对照', '概念', '覆盖（按次数）'].map((x) => h('th', { key: x }, x)))),
              h('tbody', {}, bs.map((x) => h('tr', { key: x.id, className: `click${x === b ? ' sel' : ''}`, onClick: () => { setSel(x.id); setEdit(null) } },
                h('td', {}, x.name, x.changed ? h('span', { className: 'hx-chip t', style: { marginLeft: 4 } }, `已修改 ${x.changed}`) : null),
                h('td', { className: 'hx-num' }, `${fmt(x.mappedConcepts)}/${fmt(x.conceptCount)}`), h('td', { style: { width: 110 } }, h(Coverage, { value: x.coverage }))))))),
          !b ? null : h('div', { className: 'hx-frame hx-col', style: { flex: 1, minWidth: 0 } },
            h('div', { className: 'hx-pad', style: { paddingBottom: 6 } },
              h('div', { className: 'hx-h' }, h('b', {}, b.name), b.version ? h('span', { className: 'hx-chip' }, `v${b.version}`) : null, b.reviewed ? h('span', { className: 'hx-chip t' }, `本机复核 ${b.reviewed}`) : null),
              h('div', { className: 'hx-muted', style: { fontSize: 12, lineHeight: 1.6 } }, b.description),
              h('div', { className: 'hx-faint', style: { fontSize: 11.5, marginTop: 4 } }, `目标：${b.target?.name ?? ''}（${b.target?.system ?? ''}）· 写入 ${b.lands ?? ''}`),
              h('div', { style: { display: 'flex', gap: 6, marginTop: 8, alignItems: 'center' } },
                h('select', { className: 'hx-input', value: filter, onChange: (e) => setFilter(e.target.value) }, h('option', { value: 'unmapped' }, '未对照'), h('option', { value: 'mapped' }, '已对照'), h('option', { value: 'model' }, '模型给出 · 未经人工复核'), h('option', { value: 'candidates' }, '两个模型结论不一致（有候选）'), h('option', { value: 'all' }, '全部')),
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
      if (!m?.configured) return h('div', { className: 'hx-frame hx-pad', style: { flex: 1 } }, h('div', { className: 'hx-h' }, h('b', {}, '模型调用'), h('span', { className: 'hx-cap' }, 'MODEL')), h('div', { className: 'hx-muted' }, m?.note ?? '这一批没有使用模型。'), h('div', { className: 'hx-faint', style: { marginTop: 8, fontSize: 12 } }, '在 设置 → HL7 标准化 → 模型 里配置识别模型和核验模型后，无映射规格的表由模型起草映射规格，无对照的取值和本地概念由模型给出规范值和标准代码。'))
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
              h('span', { className: 'hx-faint' }, '调用'), h('span', { className: 'hx-num' }, C ? `${fmt(C.total)} 次（实际请求 ${fmt(C.live)}，缓存 ${fmt(C.cached)}，失败 ${fmt(C.failed)}）· ${fmt(C.tokens)} token` : '—'))),
          h('div', { className: 'hx-frame hx-pad', style: { flex: 1.3 } },
            h('div', { className: 'hx-h' }, h('b', {}, '三个阶段'), h('span', { className: 'hx-cap' }, 'RESULTS')),
            h('table', {}, h('thead', {}, h('tr', {}, ['阶段', '提交模型', '结论一致 · 已采用', '转人工复核', '模型未给出结论', '失败'].map((x) => h('th', { key: x }, x)))),
              h('tbody', {},
                P.schema ? h('tr', { className: 'click', onClick: () => onTab('schema') }, h('td', {}, '① Schema 起草'), h('td', { className: 'hx-num' }, `${fmt(P.schema.tables)} 张表`), h('td', { className: 'hx-num hx-ok' }, fmt(P.schema.applied)), h('td', { className: 'hx-num hx-warn' }, fmt(P.schema.review)), h('td', {}, '—'), h('td', { className: 'hx-num' }, fmt(P.schema.failed))) : null,
                P.values ? h('tr', { className: 'click', onClick: () => onTab('domains') }, h('td', {}, '② 值域归一'), h('td', { className: 'hx-num' }, `${fmt(P.values.asked)} 个取值`), h('td', { className: 'hx-num hx-ok' }, fmt(P.values.confirmed + P.values.text + P.values.invalid)), h('td', { className: 'hx-num hx-warn' }, fmt(P.values.pending)), h('td', {}, '—'), h('td', { className: 'hx-num' }, fmt(P.values.failed))) : null,
                P.terms ? h('tr', { className: 'click', onClick: () => onTab('terms') }, h('td', {}, '③ 术语对照'), h('td', { className: 'hx-num' }, `${fmt(P.terms.asked)} 个概念`), h('td', { className: 'hx-num hx-ok' }, fmt(P.terms.confirmed)), h('td', { className: 'hx-num hx-warn' }, fmt(P.terms.review)), h('td', { className: 'hx-num' }, fmt(P.terms.abstain)), h('td', { className: 'hx-num' }, fmt(P.terms.failed))) : null)),
            h('div', { className: 'hx-faint', style: { fontSize: 11.5, marginTop: 6 } }, '采用的结果标为“模型 · 未复核”，可在对应页面确认或改正；结果存本机对照表，下次运行直接复用。'))),
        h('div', { className: 'hx-frame hx-pad' },
          h('div', { className: 'hx-h' }, h('b', {}, '交叉核验'), h('span', { className: 'hx-cap' }, 'CROSS-CHECK'), h('span', { className: 'hx-faint' }, '核验模型只看“输入 + 结论”，不看识别模型的理由')),
          h('table', {}, h('thead', {}, h('tr', {}, ['阶段', '盲审', '提出异议', '插件校验未通过', '复判修正', '维持原结论（转人工）', '一次通过'].map((x) => h('th', { key: x }, x)))),
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
        h('p', { style: { margin: 0, color: 'var(--dsw-alias-label-secondary)' } }, `此处仅包含配置。运行批次、复核对照，请使用左侧栏的「${TITLE}」页面，或在对话框中使用 /hl7 命令。`),
        h('h3', { style: { margin: '6px 0 0' } }, '模型'),
        h('p', { style: { margin: 0, fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } }, '用于：为无映射规格的表起草映射规格（Schema 同构）、为无对照的取值确定规范值（值域归一）、为本地概念匹配 LOINC / SNOMED CT 等标准代码（术语对照）。模型结果经插件校验、独立盲审和复判，两个模型结论一致才采用，不一致的转人工复核；结果保存在本机对照库，后续批次复用。病历内容只发送到此处配置的端点；发送内容仅限字段名、截短的取值样例和本地代码 / 名称，不发送文书正文。Agent 不能更改这些设置。'),
        check('modelEnabled', '启用模型'),
        h('div', { className: 'hx-grid2' },
          field('baseURL', '识别模型端点（OpenAI 兼容，以 /v1 结尾）', { placeholder: 'http://127.0.0.1:11434/v1' }), field('model', '识别模型'),
          field('verifyBaseURL', '核验模型端点（空＝同上）'), field('verifyModel', '核验模型（独立盲审；空＝用识别模型盲审）'),
          field('apiKey', form.apiKeySet ? 'API Key（已设置；留空不修改）' : 'API Key（可空）', { type: 'password' }), field('timeoutMs', '单次调用超时（毫秒）'),
          field('modelConcurrency', '每个模型同时处理的请求数'), field('maxRounds', '核验轮次上限（1–6）'),
          field('temperature', '温度'), field('loincTable', 'LOINC 代码表：LoincTable/Loinc.csv'),
          field('loincZhTable', 'LOINC 中文变体：LinguisticVariants/zhCN…LinguisticVariant.csv（建议）'), field('snomedTable', 'SNOMED CT 描述表：sct2_Description_Snapshot-….txt'),
          field('valueLimit', '每个值域最多提交模型的取值数'), field('termLimit', '每组术语对照最多提交模型的概念数')),
        h('p', { style: { margin: 0, fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } }, '术语对照的候选只从本地代码表中检索：模型在候选中选择，核验模型独立再选一次，两者一致才采用。未配置代码表的标准不提交模型（实测模型直接给出的代码约半数不存在）。LOINC 在 loinc.org 免费注册后下载。'),
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
