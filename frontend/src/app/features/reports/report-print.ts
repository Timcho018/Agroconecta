/** Informe independiente de la interfaz: A4, paginación, gráficos y tablas legibles. */
export interface PrintRow { [key: string]: unknown }
export interface PrintReport {
  generated: string;
  period: string;
  parcel: string;
  state: string;
  search: string;
  production: number;
  remaining: number;
  totalTasks: number;
  completedTasks: number;
  historyCount: number;
  lots: PrintRow[];
  tasks: PrintRow[];
  events: PrintRow[];
  bars: {name: string; kg: number}[];
}

const escapeHtml = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c] || c));
const number = (value: unknown): string => new Intl.NumberFormat('es-PE',{maximumFractionDigits:2}).format(Number(value) || 0);
const cell = (value: unknown): string => `<td>${escapeHtml(value)}</td>`;
const table = (heading: string, subheading: string, columns: string[], data: unknown[][]): string => `
  <section class="sheet-section table-section"><header class="section-head"><div><span class="eyebrow">REGISTROS</span><h2>${escapeHtml(heading)}</h2><p>${escapeHtml(subheading)}</p></div><span class="count">${data.length} registros</span></header>
    <table><thead><tr>${columns.map(x=>`<th>${escapeHtml(x)}</th>`).join('')}</tr></thead><tbody>${data.length?data.map(row=>`<tr>${row.map(cell).join('')}</tr>`).join(''):`<tr><td colspan="${columns.length}" class="empty">No hay registros para los filtros seleccionados.</td></tr>`}</tbody></table>
  </section>`;

export function buildPrintableReport(report: PrintReport): string {
  const plots = report.bars;
  const max = Math.max(1,...plots.map(v=>v.kg));
  const taskRows=report.tasks.map(t=>[t['title'],t['plot'],t['date'],t['category'],t['status'],t['notes']]);
  const lotRows=report.lots.map(l=>[l['code'],l['plot'],l['date'],number(l['quantity']),number(l['remaining']),l['stage']]);
  const historyRows=report.events.map(e=>[e['date'],e['label'],e['kind'],e['action']]);
  const percentage=report.totalTasks ? Math.round(report.completedTasks/report.totalTasks*100) : 0;
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AgroConecta | Reporte de campo</title>
  <style>
    :root{--pine:#254d3a;--ink:#23382b;--soft:#f2f5ed;--line:#dae4d7;--muted:#718272}
    *{box-sizing:border-box}body{margin:0;background:#e5e8df;font-family:'Segoe UI',Arial,sans-serif;color:var(--ink);font-size:11px;line-height:1.42}
    .tools{max-width:930px;margin:18px auto;display:flex;justify-content:space-between;align-items:center;gap:15px;padding:12px 17px;border-radius:12px;background:#fff}
    .tools strong{font-size:12px}.tools p{margin:4px 0 0;color:var(--muted)}.tools button{border:0;border-radius:8px;background:var(--pine);color:#fff;padding:11px 15px;cursor:pointer;font-weight:700}
    .paper{width:min(930px,calc(100% - 22px));margin:0 auto 30px;background:#fff;padding:44px 50px;box-shadow:0 15px 70px #23382b22}
    .mast{display:flex;justify-content:space-between;align-items:start;gap:20px;border-bottom:2px solid var(--pine);padding-bottom:18px}
    .brand{font-size:19px;font-family:Georgia,serif;letter-spacing:-.04em;color:var(--pine)}.brand:before{content:'✳';margin-right:9px;color:#82a27f}
    .tag{font-size:9px;letter-spacing:.14em;color:var(--muted);font-weight:700;text-align:right}
    h1{font:400 36px/1.1 Georgia,serif;letter-spacing:-.05em;margin:22px 0 10px;color:#203b2d}
    h2{font:400 22px/1.15 Georgia,serif;margin:5px 0 7px;color:#254835}
    .intro{display:flex;justify-content:space-between;gap:20px}.intro p,.section-head p{margin:0;color:#718272}.intro>p{margin-top:29px;white-space:nowrap;font-size:9px}
    .meta{margin:20px 0 22px;padding:13px 16px;background:#f5f7f1;border:1px solid #e1e8de;border-radius:9px;display:flex;gap:30px;flex-wrap:wrap}
    .meta span{display:block;font-size:9px;color:#7c8b7d;text-transform:uppercase;letter-spacing:.1em;margin-bottom:3px}.meta strong{font-size:11px}
    .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:9px;margin:15px 0 25px}
    .kpi{border:1px solid #dce6d9;border-radius:9px;padding:13px 12px;background:#fff}
    .kpi:first-child{background:#eaf2e8}.kpi span{display:block;font-size:9px;text-transform:uppercase;letter-spacing:.07em;color:#718375;font-weight:700}
    .kpi strong{display:block;color:#264f37;font-size:23px;line-height:1.15;margin:8px 0 3px;font-weight:700}.kpi small{font-size:9px;color:#809082}
    .section-head{display:flex;align-items:end;justify-content:space-between;gap:14px;margin:0 0 13px}
    .eyebrow{font-size:9px;color:#718e70;letter-spacing:.14em;font-weight:700}.count{padding:6px 10px;border:1px solid #dde6da;border-radius:30px;color:#58725d;font-size:9px;white-space:nowrap}
    .bars{display:grid;gap:12px;border:1px solid #e3e9e0;border-radius:10px;padding:18px}
    .bar-head{display:flex;justify-content:space-between;gap:10px;font-size:11px;font-weight:600;margin-bottom:5px}
    .track{height:9px;border-radius:7px;background:#e9f0e6;overflow:hidden}.fill{height:100%;border-radius:7px;background:#517c5c}
    .sheet-section{margin:22px 0 28px;break-inside:avoid}
    .table-section{break-inside:auto;margin-top:32px}table{width:100%;border-collapse:collapse;table-layout:fixed}
    thead{display:table-header-group}tr{break-inside:avoid;page-break-inside:avoid}
    th{background:#eaf1e8;color:#3e6148;text-align:left;font-size:9px;text-transform:uppercase;letter-spacing:.04em;padding:10px 9px}
    td{font-size:10px;line-height:1.38;padding:10px 9px;word-break:break-word;border-bottom:1px solid #e6eae3}
    tbody tr:nth-child(even){background:#fafbf8}td.empty{text-align:center;color:#869589;padding:20px}
    .foot{margin-top:32px;border-top:1px solid #dce6db;padding-top:13px;color:#879489;font-size:9px;display:flex;justify-content:space-between;gap:15px}
    @media print{ @page{size:A4 portrait;margin:14mm 14mm 17mm} body{background:#fff;print-color-adjust:exact;-webkit-print-color-adjust:exact;font-size:10px}
      .tools{display:none!important}.paper{width:100%;margin:0;padding:0;box-shadow:none}.kpis{gap:6px}.kpi{padding:10px 8px}.kpi strong{font-size:19px}
      .table-section{break-before:page;margin-top:0}.table-section+.table-section{break-before:page}
      .foot{position:relative}.bars,.kpis,.mast,.meta,.section-head{break-inside:avoid}
    }
  </style></head><body><div class="tools"><div><strong>AgroConecta · Informe listo para guardar</strong><p>Selecciona «Guardar como PDF» en la ventana de impresión. Diseño A4 sin menús ni barras de navegación.</p></div><button type="button" onclick="window.print()">Imprimir / Guardar PDF</button></div>
  <main class="paper"><div class="mast"><span class="brand">Agroconecta</span><div class="tag">CUADERNO DE CAMPO<br>INFORME DE ACTIVIDAD</div></div>
    <div class="intro"><div><h1>Reporte de tu campo.</h1><p>Historial, actividades y producción agrícola</p></div><p>Generado: ${escapeHtml(report.generated)}</p></div>
    <div class="meta"><div><span>Período</span><strong>${escapeHtml(report.period)}</strong></div><div><span>Parcela</span><strong>${escapeHtml(report.parcel)}</strong></div><div><span>Estado</span><strong>${escapeHtml(report.state)}</strong></div><div><span>Búsqueda</span><strong>${escapeHtml(report.search)}</strong></div></div>
    <div class="kpis"><div class="kpi"><span>Producción total</span><strong>${number(report.production)} kg</strong><small>Kg cosechados</small></div><div class="kpi"><span>Último peso</span><strong>${number(report.remaining)} kg</strong><small>Kg al cierre de la última etapa</small></div><div class="kpi"><span>Labores completadas</span><strong>${report.completedTasks}/${report.totalTasks}</strong><small>${percentage}% terminadas</small></div><div class="kpi"><span>Movimientos</span><strong>${report.historyCount}</strong><small>Eventos del historial</small></div></div>
    <section class="sheet-section"><header class="section-head"><div><span class="eyebrow">PRODUCCIÓN</span><h2>Distribución por parcela</h2><p>Peso inicial de los lotes en el período seleccionado</p></div></header>
    <div class="bars">${plots.length?plots.map(row=>`<div><div class="bar-head"><span>${escapeHtml(row.name)}</span><strong>${number(row.kg)} kg</strong></div><div class="track"><div class="fill" style="width:${Math.min(100,Math.max(0,row.kg/max*100)).toFixed(2)}%"></div></div></div>`).join(''):'<p>No hay cosechas registradas para este período.</p>'}</div></section>
    <div class="foot"><span>AgroConecta · Datos registrados por la cuenta, sujetos a las fechas y filtros del informe.</span><span>Los kg actuales no equivalen necesariamente a stock disponible para venta.</span></div>
    ${table('Actividades del campo','Labores planificadas y estados',['Actividad','Parcela','Fecha','Categoría','Estado','Observaciones'],taskRows)}
    ${table('Cosechas y lotes','Resumen del seguimiento productivo',['Lote','Parcela','Fecha','Kg iniciales','Kg actuales','Etapa'],lotRows)}
    ${table('Historial','Movimientos registrados en tu cuenta',['Fecha (Perú)','Registro','Tipo','Acción'],historyRows)}
  </main></body></html>`;
}
