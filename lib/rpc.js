/**
 * 页面 RPC：endpoint → 批次服务的方法。插件（index.js）和页面预览脚本（scripts/preview-page.mjs）共用。
 * extra：宿主相关的方法（系统选择对话框、保存设置），预览时可以不给。
 */
export function createDispatch(service, extra = {}) {
  return async function dispatch(endpoint, payload) {
    try {
      const r = payload && typeof payload === 'object' ? payload : {}
      const value = await (async () => {
        switch (endpoint) {
          case 'config': return { ...service.configInfo(), ...(extra.version ? { version: extra.version } : {}) }
          case 'list': return service.list()
          case 'status': return service.status(r.runId)
          case 'report': return service.report(r.runId)
          case 'start': return service.start({ inputDir: r.inputDir, outputRoot: r.outputRoot || undefined, resumeFrom: r.resumeFrom || undefined, source: { kind: 'panel' } })
          case 'cancel': return service.cancel(r.runId)
          case 'patient': return service.patientDetail(r.runId, r.patient)
          case 'resources': return service.resources(r.runId, r.patient, r.type)
          case 'resource': return service.resource(r.runId, r.patient, r.type, r.id)
          case 'mapping': return service.mapping(r.runId)
          case 'schema': return service.schemaView(r.runId)
          case 'domains': return service.domainsView(r.runId)
          case 'terminology': return service.terminologyView(r.runId)
          case 'reviewDomain': return service.reviewDomain(r)
          case 'reviewTerm': return service.reviewTerm(r)
          case 'rerun': return service.rerun(r.runId)
          case 'reviewDraft': return service.reviewDraft(r)
          case 'confirmModel': return service.confirmModel(r)
          case 'model': return service.modelView(r.runId)
          case 'testConnection': return service.testConnection(r)
          case 'deleteRun': return service.deleteRun(r.runId)
          case 'history': return service.history(r)
          case 'rulesQueue': return service.rulesQueue(r)
          case 'rulesLibrary': return service.rulesLibrary(r)
          default: {
            if (typeof extra[endpoint] === 'function') return extra[endpoint](r)
            throw Object.assign(new Error(`未知方法: ${endpoint}`), { code: 'unknown-endpoint' })
          }
        }
      })()
      return { ok: true, value: JSON.parse(JSON.stringify(value ?? null)) }
    } catch (error) {
      return { ok: false, error: { code: error?.code ?? 'medical-hl7', message: String(error?.message ?? error), details: {} } }
    }
  }
}
