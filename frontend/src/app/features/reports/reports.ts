import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Api, errorMessage } from '../../core/api';
import { Entity, HistoryEvent, peruToday } from '../../core/models';
import { Icon } from '../../shared/icon';
import { AgroDatePicker } from '../../shared/date-picker';
import { buildPrintableReport } from './report-print';
import { reportMonthKeys } from './metrics';

type View = 'resumen' | 'actividades' | 'cosechas' | 'historial';
type Detail = {title: string; category: string; rows: {label: string; value: string}[]};
const PAGE_SIZE = 7;
const months = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];

function peruDate(value: string): string {
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0,10);
  return new Intl.DateTimeFormat('en-CA', {timeZone: 'America/Lima', year:'numeric', month:'2-digit', day:'2-digit'}).format(date);
}
function decimal(value: number) { return new Intl.NumberFormat('es-PE', {maximumFractionDigits: 2}).format(value); }

@Component({
  selector:'agro-reports',
  imports:[Icon, DatePipe, DecimalPipe, AgroDatePicker, RouterLink],
  styleUrl:'./reports.scss',
  template:`
<div class="reports-v12">
  <header class="report-intro">
    <div><span class="report-kicker"><span class="report-kicker-line"></span> TU CAMPO EN DATOS</span>
      <h1>Historial <em>y reportes.</em></h1>
      <p>Una mirada clara a lo que has sembrado, organizado y cosechado.</p>
    </div>
    <div class="report-actions">
      <button type="button" class="report-btn report-btn-light" [disabled]="loading() || !rangeValid()" (click)="printReport()"><agro-icon name="clipboard"/> Guardar PDF</button>
      <button type="button" class="report-btn report-btn-dark" [disabled]="exporting() || !rangeValid()" (click)="exportExcel()"><agro-icon name="chart"/> {{exporting() ? 'Generando…' : 'Exportar Excel'}} <span>↗</span></button>
    </div>
  </header>

  <section class="report-filterbar" aria-label="Filtros de reportes">
    <div class="report-filter-title"><agro-icon name="layers"/><span>Explora tus datos</span></div>
    <div class="report-filter-grid d-grid">
      <label>Desde <agro-date-picker label="Fecha desde" [value]="from()" (valueChange)="changeFrom($event)" /></label>
      <label>Hasta <agro-date-picker label="Fecha hasta" [value]="to()" (valueChange)="changeTo($event)" /></label>
      <label>Parcela
        <select [value]="plot()" (change)="changePlot($any($event.target).value)">
          <option value="">Todas las parcelas</option>
          @for (p of plots(); track p.id) { <option [value]="p.id">{{p.name}}</option> }
        </select>
      </label>
      <label class="report-search-label">Buscar registro
        <span class="report-search-field"><agro-icon name="inspect"/><input type="search" placeholder="Nombre, lote, categoría…" [value]="query()" (input)="changeQuery($any($event.target).value)" /></span>
      </label>
      <button class="report-clear" type="button" (click)="clear()" [disabled]="!from() && !to() && !plot() && !query() && !status()">Limpiar filtros</button>
    </div>
    @if (!rangeValid()) { <p class="report-error" role="alert">La fecha inicial no puede ser posterior a la final.</p> }
  </section>

  @if (error()) { <div class="report-error" role="alert">{{error()}} <button class="text-link" (click)="load()">Volver a intentar</button></div> }
  @if (exportError()) { <div class="report-error" role="alert">{{exportError()}}</div> }
  @if (loading()) { <p class="report-loading" role="status">Preparando los datos de tu campo…</p> }

  <section class="report-metrics d-grid" aria-label="Indicadores del período">
    <article class="report-metric featured"><div class="metric-top"><span>PRODUCCIÓN REGISTRADA</span><agro-icon name="harvest"/></div>
      <div class="metric-main"><strong>{{total() | number:'1.0-2'}}</strong><span>kg</span></div><p>De {{filteredLots().length}} {{filteredLots().length===1 ? 'lote' : 'lotes'}} en el período</p>
      <div class="metric-waves" aria-hidden="true"><i></i><i></i><i></i></div>
    </article>
    <article class="report-metric"><div class="metric-top"><span>LABORES REALIZADAS</span><span class="metric-icon"><agro-icon name="check"/></span></div>
      <div class="metric-main"><strong>{{completed()}}</strong><span>/ {{filteredTasks().length}}</span></div><p>Actividades completadas</p><div class="metric-progress"><span [style.width.%]="completionPercent()"></span></div>
    </article>
    <article class="report-metric"><div class="metric-top"><span>PRODUCTO ACTUAL</span><span class="metric-icon olive"><agro-icon name="box"/></span></div>
      <div class="metric-main"><strong>{{current() | number:'1.0-2'}}</strong><span>kg</span></div><p>Último peso registrado de los lotes</p>
    </article>
    <article class="report-metric"><div class="metric-top"><span>MOVIMIENTOS</span><span class="metric-icon lavender"><agro-icon name="workflow"/></span></div>
      <div class="metric-main"><strong>{{historyFiltered().length}}</strong></div><p>Eventos registrados en la bitácora</p>
    </article>
  </section>

  <div class="report-view-head">
    <nav class="report-view-tabs" aria-label="Secciones del reporte">
      <button type="button" [class.active]="tab()==='resumen'" [attr.aria-current]="tab()==='resumen' ? 'page' : null" (click)="switchView('resumen')"><agro-icon name="grid"/> Resumen</button>
      <button type="button" [class.active]="tab()==='actividades'" [attr.aria-current]="tab()==='actividades' ? 'page' : null" (click)="switchView('actividades')"><agro-icon name="calendar"/> Actividades <span>{{filteredTasks().length}}</span></button>
      <button type="button" [class.active]="tab()==='cosechas'" [attr.aria-current]="tab()==='cosechas' ? 'page' : null" (click)="switchView('cosechas')"><agro-icon name="harvest"/> Cosechas <span>{{filteredLots().length}}</span></button>
      <button type="button" [class.active]="tab()==='historial'" [attr.aria-current]="tab()==='historial' ? 'page' : null" (click)="switchView('historial')"><agro-icon name="workflow"/> Historial <span>{{historyFiltered().length}}</span></button>
    </nav>
    <span class="report-view-caption">Datos de tu cuenta · Actualizados al abrir la página</span>
  </div>

  @if (tab()==='resumen') {
    <div class="report-main-grid">
      <section class="report-panel report-production">
        <header class="report-panel-heading"><div><span class="mini-kicker">PRODUCCIÓN</span><h2>Por parcela</h2><p>Compara el peso inicial cosechado en cada terreno.</p></div><span class="report-panel-symbol"><agro-icon name="chart"/></span></header>
        @if (grouped().length) {
          <div class="report-bars report-bars-clickable" aria-label="Producción por parcela. Selecciona una barra para ver el detalle.">
            @for (row of grouped();track row.id) {
              <button type="button" class="report-bar-row" [class.is-selected]="selectedChartPlot()===row.id" [attr.aria-pressed]="selectedChartPlot()===row.id" [attr.aria-label]="row.name + ', ' + decimal(row.kg) + ' kilogramos. Ver detalle'" (click)="selectChartPlot(row.id)">
                <span class="report-bar-label"><strong>{{row.name}}</strong><span>{{row.kg | number:'1.0-2'}} kg</span></span>
                <span class="report-bar-track"><span [style.width.%]="row.kg / maxKg() * 100"></span></span>
              </button>
            }
          </div>
          @if(chartPlot(); as p){
            <div class="report-chart-detail" aria-live="polite">
              <div><span class="mini-kicker">PARCELA SELECCIONADA</span><strong>{{p.name}}</strong><small>{{chartPlotLots().length}} lotes · {{p.kg | number:'1.0-2'}} kg cosechados</small></div>
              <button class="report-inline-link" type="button" (click)="showChartLots(p.id)">Ver sus cosechas ↗</button>
            </div>
          } @else {<p class="report-chart-hint">Selecciona una barra para explorar las cosechas de una parcela.</p>}
        } @else { <div class="report-blank"><agro-icon name="harvest"/><strong>Sin cosechas en este período</strong><p>Cuando registres tu primera cosecha, aparecerá aquí.</p><a routerLink="/produccion">Ir a Cosecha y lotes ↗</a></div> }
      </section>
      <section class="report-panel report-status">
        <header class="report-panel-heading"><div><span class="mini-kicker">PLANIFICACIÓN</span><h2>Estado de las labores</h2><p>Distribución de tus actividades.</p></div></header>
        <div class="status-composition"><div class="status-donut" role="img" [attr.aria-label]="completionPercent() + '% de labores completadas'" [style.background]="donutBackground()"><div class="status-donut-inner"><strong>{{completionPercent()}}%</strong><span>completadas</span></div></div>
          <div class="status-legend">@for (s of statuses;track s.label) {<div><i [style.background]="s.color"></i><span>{{s.label}}</span><strong>{{countStatus(s.label)}}</strong></div>}</div>
        </div>
        <a class="report-panel-link" routerLink="/planificacion">Abrir planificación <agro-icon name="arrow"/></a>
      </section>
    </div>
    <div class="report-main-grid report-secondary-grid">
      <section class="report-panel report-monthly"><header class="report-panel-heading"><div><span class="mini-kicker">EVOLUCIÓN</span><h2>Producción por mes</h2><p>Kg cosechados en los meses del período filtrado (hasta 12).</p></div></header>
        <div class="report-months" aria-label="Producción mensual. Selecciona un mes para ver el detalle.">@for (m of monthly();track m.key) {<button type="button" class="report-month" [class.is-selected]="selectedChartMonth()===m.key" [attr.aria-pressed]="selectedChartMonth()===m.key" [attr.aria-label]="m.label + ': ' + decimal(m.kg) + ' kilogramos'" (click)="selectedChartMonth.set(selectedChartMonth()===m.key ? '' : m.key)"><div class="report-month-value">{{m.kg ? decimal(m.kg) : '—'}}</div><div class="report-month-column"><span [style.height.%]="m.height"></span></div><small>{{m.label}}</small></button>}</div>
        @if(chartMonth(); as month){<div class="report-chart-detail" aria-live="polite"><div><span class="mini-kicker">MES SELECCIONADO</span><strong>{{month.label}} · {{month.key.slice(0,4)}}</strong><small>{{month.kg | number:'1.0-2'}} kg · {{monthLots().length}} lotes</small></div><button class="report-inline-link" type="button" (click)="showMonthLots(month.key)">Ver cosechas ↗</button></div>}
      </section>
      <section class="report-panel report-last"><header class="report-panel-heading"><div><span class="mini-kicker">MOVIMIENTOS RECIENTES</span><h2>Lo último en tu campo</h2></div><button class="report-inline-link" type="button" (click)="switchView('historial')">Ver todo ↗</button></header>
        @if (historyFiltered().length) {
          @for (event of historyFiltered().slice(0,4);track event.id) {
            <button type="button" class="report-recent-row" (click)="openHistory(event)"><span class="recent-icon"><agro-icon [name]="kindIcon(event.kind)"/></span><span class="recent-copy"><strong>{{event.label}}</strong><small>{{kindName(event.kind)}} · {{event.action}}</small></span><time>{{event.date | date:'d MMM':'-0500':'es'}}</time></button>
          }
        } @else { <div class="report-blank short"><p>Los próximos cambios que realices aparecerán aquí.</p></div> }
      </section>
    </div>
  }

  @if (tab()==='actividades') {
    <section class="report-panel report-table-panel"><div class="report-table-header"><div><span class="mini-kicker">REGISTRO DE ACTIVIDADES</span><h2>Labores del campo</h2><p>Consulta las labores planificadas y su estado.</p></div><label>Estado<select [value]="status()" (change)="changeStatus($any($event.target).value)"><option value="">Todos</option>@for(s of statuses;track s.label){<option [value]="s.label">{{s.label}}</option>}</select></label></div>
      <div class="report-table-scroll"><table class="report-table"><thead><tr><th>Actividad</th><th>Parcela</th><th>Fecha</th><th>Categoría</th><th>Estado</th><th></th></tr></thead><tbody>
      @for (a of visibleTasks();track a.id) {<tr><td><div class="report-cell-title"><span class="table-category-icon"><agro-icon [name]="categoryIcon(a.category)"/></span><strong>{{a.title}}</strong></div></td><td>{{plotName(a.plot_id)}}</td><td>{{a.date | date:'dd MMM yyyy':'':'es'}}</td><td>{{a.category}}</td><td><span class="report-state" [class]="statusClass(a.status)">{{a.status}}</span></td><td><button type="button" class="report-row-open" (click)="openTask(a)">Ver detalle ↗</button></td></tr>}
      </tbody></table></div>@if(!visibleTasks().length){<div class="report-blank"><agro-icon name="calendar"/><strong>Sin actividades para estos filtros</strong><p>Prueba otro período o registra una labor.</p><a routerLink="/planificacion">Ir a planificación ↗</a></div>}
      <div class="report-pagination"><span>{{filteredTasks().length}} registros</span><div><button type="button" (click)="page.set(page()-1)" [disabled]="page()<=1">‹ Anterior</button><span>{{page()}} de {{pageCount()}}</span><button type="button" (click)="page.set(page()+1)" [disabled]="page()>=pageCount()">Siguiente ›</button></div></div>
    </section>
  }

  @if (tab()==='cosechas') {
    <section class="report-panel report-table-panel"><div class="report-table-header"><div><span class="mini-kicker">TRAZABILIDAD</span><h2>Cosechas y lotes</h2><p>Del registro inicial a la última etapa del lote.</p></div><a routerLink="/produccion" class="report-inline-link">Gestionar lotes ↗</a></div>
      <div class="report-table-scroll"><table class="report-table"><thead><tr><th>Lote</th><th>Parcela</th><th>Fecha</th><th>Kg iniciales</th><th>Kg actuales</th><th>Etapa</th><th></th></tr></thead><tbody>
      @for(h of visibleLots();track h.id){<tr><td><strong>{{h.code}}</strong></td><td>{{plotName(h.plot_id)}}</td><td>{{h.date | date:'dd MMM yyyy':'':'es'}}</td><td><strong>{{h.quantity | number:'1.0-2'}}</strong></td><td>{{h.current_quantity | number:'1.0-2'}}</td><td><span class="report-state inprogress">{{h.stage}}</span></td><td><button type="button" class="report-row-open" (click)="openLot(h)">Ver detalle ↗</button></td></tr>}
      </tbody></table></div>@if(!visibleLots().length){<div class="report-blank"><agro-icon name="harvest"/><strong>Aún no hay cosechas para estos filtros</strong><p>La información aparecerá al registrar tus lotes.</p><a routerLink="/produccion">Registrar cosecha ↗</a></div>}
      <div class="report-pagination"><span>{{filteredLots().length}} registros</span><div><button type="button" (click)="page.set(page()-1)" [disabled]="page()<=1">‹ Anterior</button><span>{{page()}} de {{pageCount()}}</span><button type="button" (click)="page.set(page()+1)" [disabled]="page()>=pageCount()">Siguiente ›</button></div></div>
    </section>
  }

  @if (tab()==='historial') {
    <section class="report-panel report-timeline-panel"><header class="report-panel-heading"><div><span class="mini-kicker">BITÁCORA DE CAMBIOS</span><h2>La historia de tu campo</h2><p>Registro cronológico de cambios y actividades del sistema.</p></div><span class="report-event-count">{{historyFiltered().length}} eventos</span></header>
      @if(visibleHistory().length){<div class="report-timeline">@for(e of visibleHistory();track e.id){<button class="report-timeline-item" type="button" (click)="openHistory(e)"><span class="timeline-dot"><agro-icon [name]="kindIcon(e.kind)"/></span><span class="timeline-body"><strong>{{e.label}}</strong><small>{{kindName(e.kind)}} <span class="timeline-sep">·</span> {{e.action}}</small></span><time>{{e.date | date:'dd MMM yyyy, HH:mm':'-0500':'es'}}</time><span class="timeline-arrow">↗</span></button>}</div>}
      @else {<div class="report-blank"><agro-icon name="workflow"/><strong>No hay eventos con estos filtros</strong><p>La bitácora conserva los cambios hechos en tu cuenta.</p></div>}
      <div class="report-pagination"><span>{{historyFiltered().length}} eventos</span><div><button type="button" (click)="page.set(page()-1)" [disabled]="page()<=1">‹ Anterior</button><span>{{page()}} de {{pageCount()}}</span><button type="button" (click)="page.set(page()+1)" [disabled]="page()>=pageCount()">Siguiente ›</button></div></div>
    </section>
  }

  <footer class="report-footer"><agro-icon name="info"/><span>Los indicadores utilizan únicamente los registros de tu cuenta. Los kg actuales reflejan la última etapa, no el stock disponible para venta.</span><button type="button" (click)="load(true)">Actualizar ↻</button></footer>

  @if(detail()){<div class="report-modal-backdrop" role="presentation" (click)="closeDetail()"><section class="report-modal" role="dialog" aria-modal="true" aria-label="Detalle de registro" (click)="$event.stopPropagation()"><header><span class="mini-kicker">{{detail()!.category}}</span><button type="button" (click)="closeDetail()" aria-label="Cerrar detalle">×</button></header><h2>{{detail()!.title}}</h2><div class="report-detail-grid">@for(row of detail()!.rows;track row.label){<div><span>{{row.label}}</span><strong>{{row.value}}</strong></div>}</div><footer><button class="report-btn report-btn-dark" type="button" (click)="closeDetail()">Cerrar</button></footer></section></div>}
</div>
`})
export class Reports implements OnInit {
  api = inject(Api);
  lots=signal<Entity[]>(this.api.peek<Entity[]>('harvests')??[]); tasks=signal<Entity[]>(this.api.peek<Entity[]>('activities')??[]); plots=signal<Entity[]>(this.api.peek<Entity[]>('plots')??[]); history=signal<HistoryEvent[]>(this.api.peek<HistoryEvent[]>('history')??[]);
  loading=signal(true);error=signal('');exportError=signal('');exporting=signal(false);
  from=signal('');to=signal('');plot=signal('');query=signal('');status=signal('');
  tab=signal<View>('resumen');page=signal(1);detail=signal<Detail|null>(null);selectedChartPlot=signal('');selectedChartMonth=signal('');
  statuses=[{label:'Pendiente',color:'#d8af75'},{label:'En curso',color:'#8b93c1'},{label:'Completada',color:'#518365'},{label:'Cancelada',color:'#b3b3ae'}];
  rangeValid=computed(()=>!this.from()||!this.to()||this.from()<=this.to());
  inRange(date:string){return this.rangeValid() && (!this.from()||date>=this.from()) && (!this.to()||date<=this.to());}
  plotName(id:string){return this.plots().find(p=>p.id===id)?.name||'Parcela';}
  matches(...values:unknown[]){const q=this.query().trim().toLocaleLowerCase('es');return !q||values.some(v=>String(v??'').toLocaleLowerCase('es').includes(q));}
  filteredLots=computed(()=>this.lots().filter(h=>this.inRange(h.date)&&(!this.plot()||h.plot_id===this.plot())&&this.matches(h.code,h.stage,h.notes,this.plotName(h.plot_id))).sort((a,b)=>b.date.localeCompare(a.date)));
  filteredTasks=computed(()=>this.tasks().filter(t=>this.inRange(t.date)&&(!this.plot()||t.plot_id===this.plot())&&(!this.status()||t.status===this.status())&&this.matches(t.title,t.category,t.status,t.notes,this.plotName(t.plot_id))).sort((a,b)=>b.date.localeCompare(a.date)));
  historyFiltered=computed(()=>this.history().filter(e=>{
    const d=peruDate(e.date);if(!this.inRange(d)) return false;
    if(this.plot()) {const record=e.record_id;const related=[...this.lots(),...this.tasks()].some(r=>r.id===record&&r.plot_id===this.plot());if(e.plot_id!==this.plot()&&!(e.kind==='plots'&&record===this.plot())&&!related)return false;}
    return this.matches(e.label,e.kind,e.action);
  }).sort((a,b)=>b.date.localeCompare(a.date)));
  total=computed(()=>this.filteredLots().reduce((sum,h)=>sum+(Number(h.quantity)||0),0));
  current=computed(()=>this.filteredLots().reduce((sum,h)=>sum+(Number(h.current_quantity)||0),0));
  completed=computed(()=>this.filteredTasks().filter(t=>t.status==='Completada').length);
  completionPercent=computed(()=>this.filteredTasks().length?Math.round(100*this.completed()/this.filteredTasks().length):0);
  grouped=computed(()=>this.plots().map(p=>({id:p.id,name:p.name,kg:this.filteredLots().filter(h=>h.plot_id===p.id).reduce((sum,h)=>sum+(Number(h.quantity)||0),0)})).filter(v=>v.kg>0).sort((a,b)=>b.kg-a.kg));
  maxKg=computed(()=>Math.max(1,...this.grouped().map(x=>x.kg)));
  chartPlot=computed(()=>this.grouped().find(p=>p.id===this.selectedChartPlot())||null);
  chartPlotLots=computed(()=>this.filteredLots().filter(h=>h.plot_id===this.selectedChartPlot()));
  monthLots=computed(()=>this.filteredLots().filter(h=>h.date.startsWith(this.selectedChartMonth())));
  selectChartPlot(id:string){this.selectedChartPlot.set(this.selectedChartPlot()===id ? '' : id);}
  showChartLots(id:string){this.plot.set(id);this.switchView('cosechas');}
  showMonthLots(key:string){this.from.set(key+'-01');const [y,m]=key.split('-').map(Number);this.to.set(new Date(Date.UTC(y,m,0)).toISOString().slice(0,10));this.switchView('cosechas');}
  countStatus(status:string){return this.filteredTasks().filter(t=>t.status===status).length;}
  donutBackground=computed(()=>{const list=this.statuses;const all=this.filteredTasks().length;if(!all)return 'conic-gradient(#e9ece6 0 100%)';let offset=0;const parts:string[]=[];for(const s of list){const width=100*this.countStatus(s.label)/all;parts.push(`${s.color} ${offset}% ${offset+width}%`);offset+=width;}return `conic-gradient(${parts.join(',')})`;});
  monthly=computed(()=>{
    const keys = reportMonthKeys(this.from(), this.to(), peruToday());
    const totals = new Map<string,number>();
    for (const h of this.filteredLots()) {
      const key = h.date.slice(0,7);
      totals.set(key, (totals.get(key)||0) + (Number(h.quantity)||0));
    }
    const items=keys.map(key=>({key,label:months[Number(key.slice(5,7))-1],kg:totals.get(key)||0,height:0}));
    const max=Math.max(1,...items.map(v=>v.kg));return items.map(v=>({...v,height:v.kg>0?Math.max(4,v.kg/max*100):0}));
  });
  chartMonth=computed(()=>this.monthly().find(m=>m.key===this.selectedChartMonth())||null);
  listLength=computed(()=>this.tab()==='actividades'?this.filteredTasks().length:this.tab()==='cosechas'?this.filteredLots().length:this.historyFiltered().length);
  pageCount=computed(()=>Math.max(1,Math.ceil(this.listLength()/PAGE_SIZE)));
  visibleTasks=computed(()=>this.filteredTasks().slice((this.page()-1)*PAGE_SIZE,this.page()*PAGE_SIZE));
  visibleLots=computed(()=>this.filteredLots().slice((this.page()-1)*PAGE_SIZE,this.page()*PAGE_SIZE));
  visibleHistory=computed(()=>this.historyFiltered().slice((this.page()-1)*PAGE_SIZE,this.page()*PAGE_SIZE));
  decimal=decimal;
  ngOnInit(){void this.load();}
  async load(force=false){if(force)this.api.invalidate();this.error.set('');this.loading.set(!(this.api.peek('harvests') && this.api.peek('activities') && this.api.peek('plots') && this.api.peek('history')));try{const [l,t,p,h]=await Promise.all([this.api.list('harvests'),this.api.list('activities'),this.api.list('plots'),this.api.cached<HistoryEvent[]>('history',60000)]);this.lots.set(l);this.tasks.set(t);this.plots.set(p);this.history.set(h);}catch(e){this.error.set(errorMessage(e));}finally{this.loading.set(false);}}
  resetPage(){this.page.set(1);}changeFrom(v:string){this.from.set(v);this.resetPage();}changeTo(v:string){this.to.set(v);this.resetPage();}changePlot(v:string){this.plot.set(v);this.resetPage();}changeQuery(v:string){this.query.set(v);this.resetPage();}changeStatus(v:string){this.status.set(v);this.resetPage();}
  switchView(v:View){this.tab.set(v);this.resetPage();}
  clear(){this.from.set('');this.to.set('');this.plot.set('');this.query.set('');this.status.set('');this.resetPage();}
  categoryIcon(category:string){return ({Inspección:'inspect',Mantenimiento:'maintenance',Siembra:'seedling',Cosecha:'harvest',Poscosecha:'postharvest'} as Record<string,string>)[category]||'clipboard';}
  kindName(kind:string){return ({plots:'Parcela',crops:'Cultivo',activities:'Actividad',harvests:'Cosecha',templates:'Plantilla'} as Record<string,string>)[kind]||'Registro';}
  kindIcon(kind:string){return ({plots:'map',crops:'leaf',activities:'calendar',harvests:'harvest',templates:'workflow'} as Record<string,string>)[kind]||'clipboard';}
  statusClass(s:string){return ({Pendiente:'pending','En curso':'inprogress',Completada:'completed',Cancelada:'cancelled'} as Record<string,string>)[s]||'';}
  openTask(a:Entity){this.detail.set({title:a.title,category:'ACTIVIDAD',rows:[{label:'Parcela',value:this.plotName(a.plot_id)},{label:'Fecha planificada',value:a.date},{label:'Categoría',value:a.category},{label:'Estado',value:a.status},{label:'Observaciones',value:a.notes||'Sin observaciones'}]});}
  openLot(h:Entity){this.detail.set({title:h.code,category:'COSECHA Y LOTE',rows:[{label:'Parcela',value:this.plotName(h.plot_id)},{label:'Fecha de cosecha',value:h.date},{label:'Kg iniciales',value:decimal(h.quantity)+' kg'},{label:'Kg de última etapa',value:decimal(h.current_quantity)+' kg'},{label:'Etapa actual',value:h.stage},{label:'Observaciones',value:h.notes||'Sin observaciones'}]});}
  openHistory(e:HistoryEvent){this.detail.set({title:e.label,category:'EVENTO DEL HISTORIAL',rows:[{label:'Tipo de registro',value:this.kindName(e.kind)},{label:'Acción',value:e.action},{label:'Fecha y hora',value:new Intl.DateTimeFormat('es-PE',{dateStyle:'long',timeStyle:'short',timeZone:'America/Lima'}).format(new Date(e.date))}]});}
  closeDetail(){this.detail.set(null);}
  async exportExcel(){if(this.exporting()||!this.rangeValid())return;this.exportError.set('');this.exporting.set(true);try{const params=new URLSearchParams();if(this.from())params.set('start',this.from());if(this.to())params.set('end',this.to());if(this.plot())params.set('plot_id',this.plot());if(this.query().trim())params.set('q',this.query().trim());if(this.status())params.set('status',this.status());const response=await fetch('/api/reports/export.xlsx?'+params,{credentials:'same-origin'});if(!response.ok)throw new Error('No se pudo generar el Excel. Comprueba que FastAPI esté funcionando.');const blob=await response.blob();const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='AgroConecta_Reporte_'+peruToday()+'.xlsx';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);}catch(e){this.exportError.set(e instanceof Error?e.message:'No se pudo generar el Excel.');}finally{this.exporting.set(false);}}
  printReport(){
    if(this.loading()||!this.rangeValid())return;
    this.exportError.set('');
    const generated=new Intl.DateTimeFormat('es-PE',{dateStyle:'long',timeStyle:'short',timeZone:'America/Lima'}).format(new Date());
    const html=buildPrintableReport({
      generated,period:`${this.from()||'Inicio'} — ${this.to()||'Hoy'}`,parcel:this.plot()?this.plotName(this.plot()):'Todas las parcelas',state:this.status()||'Todos',search:this.query().trim()||'Sin búsqueda',
      production:this.total(),remaining:this.current(),totalTasks:this.filteredTasks().length,completedTasks:this.completed(),historyCount:this.historyFiltered().length,
      bars:this.grouped(),tasks:this.filteredTasks().map(t=>({title:t.title,plot:this.plotName(t.plot_id),date:t.date,category:t.category,status:t.status,notes:t.notes||'—'})),
      lots:this.filteredLots().map(l=>({code:l.code,plot:this.plotName(l.plot_id),date:l.date,quantity:l.quantity,remaining:l.current_quantity,stage:l.stage})),
      events:this.historyFiltered().map(e=>({date:new Intl.DateTimeFormat('es-PE',{dateStyle:'short',timeStyle:'short',timeZone:'America/Lima'}).format(new Date(e.date)),label:e.label,kind:this.kindName(e.kind),action:e.action}))
    });
    const printWindow=window.open('','_blank');
    if(!printWindow){this.exportError.set('Tu navegador bloqueó la ventana del reporte. Permite las ventanas emergentes para AgroConecta.');return;}
    printWindow.opener=null;
    let printed=false;
    const launchPrint=()=>{if(printed || printWindow.closed)return;printed=true;printWindow.focus();printWindow.print();};
    printWindow.addEventListener('load',()=>setTimeout(launchPrint,350),{once:true});
    printWindow.document.open();printWindow.document.write(html);printWindow.document.close();
    setTimeout(launchPrint,1000);
  }
}
