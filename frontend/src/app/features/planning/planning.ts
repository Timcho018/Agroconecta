import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Api, errorMessage } from '../../core/api';
import { Entity, FieldSpec, peruToday } from '../../core/models';
import { Editor } from '../../shared/editor';
import { Icon } from '../../shared/icon';

const categories=['Inspección','Mantenimiento','Siembra','Cosecha','Poscosecha','Otra'];
const statuses=['Pendiente','En curso','Completada','Cancelada'];
const options=(values:string[])=>values.map(value=>({value,label:value}));
type Action = { kind:'delete'|'complete'|'delete-template'; task:Entity };

@Component({
  selector:'agro-planning',
  imports:[Editor,Icon,DatePipe],
  styleUrl:'./planning.scss',
  template:`
  <div class="page-heading planning-heading">
    <div><span class="eyebrow">TU AGENDA AGRÍCOLA</span><h1>Planificación<span>.</span></h1><p>Organiza tus labores y mantén el campo al día.</p></div>
    <div class="actions"><button class="button ghost" (click)="template()">＋ Plantilla</button><button class="button" (click)="edit()"><agro-icon name="plus" /> Nueva actividad</button></div>
  </div>
  @if(error()){<p class="error" role="alert">{{error()}}</p><button class="button ghost" (click)="load()">Reintentar</button>}
  @if(notice()){<div class="planning-notice" role="status"><span aria-hidden="true">✓</span>{{notice()}}<button type="button" (click)="notice.set('')" aria-label="Cerrar aviso">×</button></div>}
  @if(!plots().some(isActive) && !loading()){<p class="info">Registra una parcela activa para comenzar a planificar.</p>}

  <div class="planning-layout planning-v7">
    <section class="card calendar" aria-label="Calendario de actividades">
      <div class="section-head"><div><span class="planning-small-kicker">CALENDARIO DE LABORES</span><h2>{{monthLabel()}}</h2></div>
        <div class="actions"><button class="icon-button" aria-label="Mes anterior" (click)="move(-1)">‹</button><button class="planning-today" (click)="resetMonth()">Hoy</button><button class="icon-button" aria-label="Mes siguiente" (click)="move(1)">›</button></div></div>
      <div class="calendar-grid"><span class="weekday">LUN</span><span class="weekday">MAR</span><span class="weekday">MIÉ</span><span class="weekday">JUE</span><span class="weekday">VIE</span><span class="weekday">SÁB</span><span class="weekday">DOM</span>
        @for(day of days();track day.date){
          <button type="button" class="calendar-day" [class.outside]="!day.current" [class.today]="day.date===today"
            [class.selected]="selectedDay()===day.date" [class.drop-target]="dragTarget()===day.date"
            (click)="selectDay(day.date)" (dblclick)="openDay(day.date)"
            (dragover)="allowDrop($event,day.date)" (dragleave)="leaveDrop($event,day.date)" (drop)="dropTemplate($event,day.date)"
            [attr.aria-label]="day.date + ', ' + day.tasks.length + ' actividades' + (day.tasks.length ? ': ' + day.categoryNames : '') + '. Doble clic para abrir el detalle. ' + (draggedTemplate() ? 'Suelta la plantilla aquí.' : '')">
            <span class="day-heading-line"><span class="day-number">{{day.number}}</span></span>
            @if(day.tasks.length){
              <span class="day-activity-summary">
                <span class="day-category-icons" aria-hidden="true">
                  @for(task of day.tasks.slice(0,3);track task.id){
                    <span class="day-category-icon" [class]="'day-category-icon tone-'+categoryTone(task.category)" [title]="task.category + ': ' + task.title">
                      <agro-icon [name]="categoryIcon(task.category)" />
                    </span>
                  }
                  @if(day.tasks.length>3){<span class="day-category-more">+{{day.tasks.length-3}}</span>}
                </span>
                <span class="activity-total" [class.all-done]="day.completed===day.tasks.length" [title]="day.tasks.length + (day.tasks.length===1?' labor':' labores')">{{day.tasks.length}}</span>
              </span>
            }
          </button>
        }
      </div>
      <div class="calendar-legend"><span><i class="legend-dot pending"></i> Actividades programadas</span><span><i class="legend-dot done"></i> Completadas</span><span class="calendar-help">Doble clic para abrir el día · Arrastra una plantilla al calendario</span></div>
    </section>
    <aside class="card template-panel">
      <div class="section-head"><div><span class="planning-small-kicker">ORGANIZA MÁS RÁPIDO</span><h2>Mis plantillas</h2></div><agro-icon name="leaf" /></div>
      <p class="template-help">Arrastra una tarjeta hasta la fecha. También puedes pulsar <strong>Usar</strong>.</p>
      <div class="template-list">
        @for(t of templates();track t.id){
          <article class="template-item" draggable="true" (dragstart)="dragStart($event,t)" (dragend)="dragEnd()" [class.is-dragging]="draggedTemplate()?.id===t.id">
            <div class="template-top"><span class="template-category"><agro-icon [name]="categoryIcon(t.category)" />{{t.category}}</span><span class="template-grip" aria-hidden="true">⠿</span></div>
            <strong>{{t.name}}</strong><p>{{t.title}}</p>
            <div class="template-actions"><button type="button" (click)="useTemplate(t)">Usar ↗</button><button type="button" (click)="template(t)">Editar</button><button class="template-delete" type="button" [disabled]="busy()" [attr.aria-label]="'Eliminar plantilla '+t.name" (click)="askDeleteTemplate(t)">Eliminar</button></div>
          </article>
        }
        @if(!templates().length){<div class="template-empty">Tus labores frecuentes aparecerán aquí como tarjetas para arrastrarlas al calendario.</div>}
      </div>
      <button class="button ghost full template-new" (click)="template()">＋ Crear plantilla</button>
    </aside>
  </div>

  <section class="card agenda planning-agenda">
    <div class="section-head planning-agenda-head">
      <div>
        <span class="planning-small-kicker">SEGUIMIENTO DE LABORES</span>
        <h2>{{selectedDay() ? 'Actividades del ' + friendlyDate(selectedDay()) : 'Actividades del mes'}}</h2>
        <p>Organiza las labores y consulta el avance de tu campo de un vistazo.</p>
      </div>
      <div class="agenda-controls">
        @if(selectedDay()){<button class="text-link" type="button" (click)="openDay(selectedDay())">Ver día completo ↗</button><button class="text-link" type="button" (click)="selectedDay.set('')">Ver el mes</button>}
        <label class="inline-filter">Estado<select [value]="status()" (change)="status.set($any($event.target).value)"><option value="">Todos</option>@for(s of statuses;track s){<option>{{s}}</option>}</select></label>
      </div>
    </div>
    <div class="agenda-overview" aria-label="Resumen de actividades">
      <div class="agenda-overview-metric"><span class="agenda-metric-icon total">▦</span><span><strong>{{agendaStats().total}}</strong><small>Total de labores</small></span></div>
      <div class="agenda-overview-metric"><span class="agenda-metric-icon pending">◷</span><span><strong>{{agendaStats().pending}}</strong><small>Pendientes</small></span></div>
      <div class="agenda-overview-metric"><span class="agenda-metric-icon done">✓</span><span><strong>{{agendaStats().completed}}</strong><small>Completadas</small></span></div>
      <div class="agenda-progress-panel"><div class="agenda-progress-top"><span>Progreso de labores</span><strong>{{agendaStats().progress}}%</strong></div><div class="agenda-progress-line" role="progressbar" [attr.aria-valuenow]="agendaStats().progress" aria-valuemin="0" aria-valuemax="100" aria-label="Porcentaje de labores completadas"><span [style.width.%]="agendaStats().progress"></span></div><small>{{agendaStats().completed}} de {{agendaStats().total}} terminadas</small></div>
    </div>
    <div class="agenda-list planning-agenda-list">
      @for(task of filtered();track task.id){
        <article class="planning-task-card" [class.task-done]="task.status==='Completada'" [class.task-cancelled]="task.status==='Cancelada'">
          <div class="planning-task-date"><strong>{{task.date | date:'dd'}}</strong><small>{{task.date | date:'MMM':'':'es'}}</small></div>
          <div class="planning-task-content"><span class="planning-task-category"><agro-icon [name]="categoryIcon(task.category)" />{{task.category}} <span aria-hidden="true">·</span> {{plotName(task.plot_id)}}</span><h3>{{task.title}}</h3>@if(task.notes){<p>{{task.notes}}</p>}</div>
          <div class="planning-task-side">
            <span class="planning-status" [class.status-done]="task.status==='Completada'" [class.status-progress]="task.status==='En curso'" [class.status-cancelled]="task.status==='Cancelada'"> <span class="planning-status-dot"></span>{{task.status}}</span>
            <div class="planning-activity-actions">
              @if(task.status!=='Completada' && task.status!=='Cancelada'){<button class="task-complete" type="button" [disabled]="busy()" (click)="askComplete(task)"><span aria-hidden="true">✓</span> Completar</button>}
              <button class="planning-task-edit" type="button" (click)="edit(task)">Editar</button>
              <button class="task-delete" type="button" [disabled]="busy()" (click)="askDelete(task)">Eliminar</button>
            </div>
          </div>
        </article>
      }
    </div>
    @if(!filtered().length){<div class="planning-agenda-empty"><div class="planning-empty-icon">▦</div><h3>{{status() ? 'Sin actividades con este estado' : 'Todo listo para empezar'}}</h3><p>{{status() ? 'Prueba con otro estado para revisar las labores.' : 'Organiza una labor nueva o arrastra una plantilla hasta el calendario.'}}</p><button class="button ghost" type="button" (click)="edit()">＋ Nueva actividad</button></div>}
  </section>

  @if(dayModal(); as dayDate){
    <div class="modal-backdrop planning-modal-backdrop">
      <section class="planning-day-dialog" role="dialog" aria-modal="true" aria-labelledby="day-detail-title">
        <header class="planning-day-head"><div><span class="planning-small-kicker">DETALLE DEL DÍA</span><h2 id="day-detail-title">{{friendlyDate(dayDate)}}</h2><p>{{tasksFor(dayDate).length}} {{tasksFor(dayDate).length===1?'actividad':'actividades'}} planificadas</p></div><button type="button" class="planning-close" aria-label="Cerrar día" (click)="dayModal.set('')">×</button></header>
        <div class="planning-day-body">
          @for(t of tasksFor(dayDate);track t.id){
            <article class="day-task"><div class="day-task-main"><span class="badge" [class.completed]="t.status==='Completada'">{{t.status}}</span><h3>{{t.title}}</h3><p class="day-task-category"><agro-icon [name]="categoryIcon(t.category)" />{{plotName(t.plot_id)}} · {{t.category}}</p>@if(t.notes){<p class="day-task-note">{{t.notes}}</p>}</div>
              <div class="day-task-actions">@if(t.status!=='Completada'){<button type="button" class="task-complete" (click)="askComplete(t)">✓ Completar</button>}<button class="text-link" type="button" (click)="dayModal.set('');edit(t)">Editar</button><button class="task-delete" type="button" (click)="askDelete(t)">Eliminar</button></div>
            </article>
          }
          @if(!tasksFor(dayDate).length){<p class="planning-no-tasks">Este día todavía no tiene actividades. Puedes crear una o arrastrar una plantilla aquí.</p>}
        </div>
        <footer><button class="button ghost" type="button" (click)="dayModal.set('')">Cerrar</button><button class="button" type="button" (click)="dayModal.set('');selectedDay.set(dayDate);edit()">＋ Añadir actividad</button></footer>
      </section>
    </div>
  }
  @if(action(); as a){
    <div class="modal-backdrop planning-alert-layer">
      <section class="planning-confirm" role="alertdialog" aria-modal="true" aria-labelledby="confirm-task-title" aria-describedby="confirm-task-copy">
        <span class="planning-confirm-icon" [class.danger]="a.kind!=='complete'">{{a.kind==='complete'?'✓':'!'}}</span>
        <h2 id="confirm-task-title">{{a.kind==='delete-template'?'¿Eliminar esta plantilla?':a.kind==='delete'?'¿Eliminar esta actividad?':'¿Marcar como completada?'}}</h2>
        <p id="confirm-task-copy">{{a.kind==='delete-template'?'Eliminarás la plantilla «'+a.task.name+'». Las actividades que ya programaste con ella se conservarán. Esta acción no se puede deshacer.':a.kind==='delete'?'Eliminarás «'+a.task.title+'» de tu planificación. No se podrá recuperar desde la aplicación.':'La actividad «'+a.task.title+'» quedará registrada como completada.'}}</p>
        @if(actionError()){<p class="error" role="alert">{{actionError()}}</p>}
        <footer><button type="button" class="button ghost" [disabled]="busy()" (click)="action.set(null)">Cancelar</button><button type="button" class="button" [class.danger]="a.kind!=='complete'" [disabled]="busy()" (click)="confirmAction()">{{busy()?'Guardando…':a.kind==='delete-template'?'Eliminar plantilla':a.kind==='delete'?'Sí, eliminar':'Sí, completar'}}</button></footer>
      </section>
    </div>
  }
  @if(editor()){<agro-editor [title]="templateMode() ? (selected() ? 'Editar plantilla' : 'Nueva plantilla') : (selected() ? 'Editar actividad' : 'Planificar actividad')" [fields]="fields()" [initial]="initial()" [busy]="busy()" [error]="formError()" (saved)="save($event)" (closed)="editor.set(false)" />}
  `
})
export class Planning implements OnInit {
  api=inject(Api); today=peruToday();month=signal(this.today.slice(0,7));selectedDay=signal('');status=signal('');
  tasks=signal<Entity[]>(this.api.peek<Entity[]>('activities')??[]);plots=signal<Entity[]>(this.api.peek<Entity[]>('plots')??[]);templates=signal<Entity[]>((this.api.peek<Entity[]>('templates')??[]).filter(t=>t.purpose!=='harvest'));
  error=signal('');notice=signal('');loading=signal(!this.api.peek<Entity[]>('activities'));editor=signal(false);templateMode=signal(false);
  selected=signal<Entity|null>(null);initial=signal<Record<string,unknown>>({});busy=signal(false);formError=signal('');
  dayModal=signal('');action=signal<Action|null>(null);actionError=signal('');draggedTemplate=signal<Entity|null>(null);dragTarget=signal('');
  statuses=statuses;isActive=(p:Entity)=>p.active;
  /** Visual category mapping used by calendar, daily detail and templates. */
  categoryIcon(value:string):string {
    switch(value){
      case 'Inspección': return 'inspect';
      case 'Mantenimiento': return 'maintenance';
      case 'Siembra': return 'seedling';
      case 'Cosecha': return 'harvest';
      case 'Poscosecha': return 'postharvest';
      default: return 'clipboard';
    }
  }
  categoryTone(value:string):string {
    switch(value){
      case 'Inspección': return 'inspection';
      case 'Mantenimiento': return 'maintenance';
      case 'Siembra': return 'sowing';
      case 'Cosecha': return 'harvest';
      case 'Poscosecha': return 'postharvest';
      default: return 'other';
    }
  }

  monthLabel=computed(()=>{const label=new Intl.DateTimeFormat('es-PE',{month:'long',year:'numeric'}).format(new Date(this.month()+'-15T12:00:00'));return label.charAt(0).toUpperCase()+label.slice(1);});
  days=computed(()=>{const [y,m]=this.month().split('-').map(Number);const start=new Date(y,m-1,1,12);start.setDate(start.getDate()-(start.getDay()+6)%7);return Array.from({length:42},(_,i)=>{const day=new Date(start);day.setDate(start.getDate()+i);const date=`${day.getFullYear()}-${String(day.getMonth()+1).padStart(2,'0')}-${String(day.getDate()).padStart(2,'0')}`;const tasks=this.tasks().filter(t=>t.date===date);return {date,number:day.getDate(),current:day.getMonth()===m-1,tasks,categoryNames:tasks.map(t=>t.category).join(', '),completed:tasks.filter(t=>t.status==='Completada').length};});});
  filtered=computed(()=>this.tasks().filter(t=>(this.selectedDay()?t.date===this.selectedDay():t.date.startsWith(this.month()))&&(!this.status()||t.status===this.status())).sort((a,b)=>a.date.localeCompare(b.date)));
  agendaStats=computed(()=>{const list=this.tasks().filter(t=>this.selectedDay()?t.date===this.selectedDay():t.date.startsWith(this.month()));const completed=list.filter(t=>t.status==='Completada').length;const pending=list.filter(t=>t.status==='Pendiente'||t.status==='En curso').length;return {total:list.length,completed,pending,progress:list.length?Math.round(100*completed/list.length):0};});
  fields=computed<FieldSpec[]>(()=>this.templateMode()?[{key:'name',label:'Nombre de la plantilla',required:true,minLength:2},{key:'title',label:'Título de la actividad',required:true,minLength:2},{key:'category',label:'Categoría',type:'select',required:true,options:options(categories)},{key:'notes',label:'Descripción de la labor',type:'textarea'}]:[
    {key:'title',label:'Actividad',required:true,minLength:2},{key:'plot_id',label:'Parcela',type:'select',required:true,options:this.plots().filter(p=>p.active||p.id===this.selected()?.plot_id).map(p=>({value:p.id,label:p.name}))},
    {key:'date',label:'Fecha',type:'date',required:true},{key:'category',label:'Categoría',type:'select',required:true,options:options(categories)},{key:'status',label:'Estado',type:'select',required:true,options:options(statuses)},{key:'notes',label:'Observaciones',type:'textarea'}]);
  ngOnInit(){void this.load();}
  async load(){this.error.set('');this.loading.set(!this.api.peek<Entity[]>('activities'));try{const [t,p,templates]=await Promise.all([this.api.list('activities'),this.api.list('plots'),this.api.list('templates')]);this.tasks.set(t);this.plots.set(p);this.templates.set(templates.filter(t=>t.purpose!=='harvest'));}catch(e){this.error.set(errorMessage(e));}finally{this.loading.set(false);}}
  plotName(id:string){return this.plots().find(p=>p.id===id)?.name||'Parcela';}
  friendlyDate(value:string){return new Intl.DateTimeFormat('es-PE',{day:'numeric',month:'long',year:'numeric',weekday:'long'}).format(new Date(value+'T12:00:00'));}
  tasksFor(value:string){return this.tasks().filter(t=>t.date===value).sort((a,b)=>a.title.localeCompare(b.title,'es'));}
  move(delta:number){const [y,m]=this.month().split('-').map(Number);const date=new Date(y,m-1+delta,15);this.month.set(`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`);this.selectedDay.set('');}
  resetMonth(){this.month.set(this.today.slice(0,7));this.selectedDay.set(this.today);}
  selectDay(date:string){this.selectedDay.set(this.selectedDay()===date?'':date);this.notice.set('');}
  openDay(date:string){this.selectedDay.set(date);this.dayModal.set(date);}
  edit(t?:Entity,defaults?:Record<string,unknown>){this.templateMode.set(false);this.selected.set(t||null);this.initial.set(t?{...t}:{date:this.selectedDay()||this.today,category:'Otra',status:'Pendiente',...(defaults||{})});this.formError.set('');this.editor.set(true);}
  template(t?:Entity){this.templateMode.set(true);this.selected.set(t||null);this.initial.set(t?{...t}:{category:'Otra'});this.formError.set('');this.editor.set(true);}
  useTemplate(t:Entity,date?:string){this.edit(undefined,{title:(t.title||t.name||'').trim(),category:t.category||'Otra',notes:t.notes||'',date:date||this.selectedDay()||this.today});}
  dragStart(event:DragEvent,t:Entity){this.draggedTemplate.set(t);event.dataTransfer?.setData('text/plain',t.id);if(event.dataTransfer)event.dataTransfer.effectAllowed='copy';this.notice.set('');}
  dragEnd(){this.draggedTemplate.set(null);this.dragTarget.set('');}
  allowDrop(event:DragEvent,date:string){if(!this.draggedTemplate())return;event.preventDefault();if(event.dataTransfer)event.dataTransfer.dropEffect='copy';this.dragTarget.set(date);}
  leaveDrop(event:DragEvent,date:string){const node=event.currentTarget as HTMLElement;if(!node.contains(event.relatedTarget as Node)&&this.dragTarget()===date)this.dragTarget.set('');}
  dropTemplate(event:DragEvent,date:string){
    event.preventDefault();
    const dragged=this.draggedTemplate();
    this.dragEnd();
    if(!dragged || this.busy())return;
    // Drag & drop only prepares the editor. A save requires explicit confirmation.
    this.selectedDay.set(date);
    this.month.set(date.slice(0,7));
    this.notice.set('');
    this.useTemplate(dragged,date);
    if(!this.plots().some(p=>p.active)){
      this.formError.set('Registra una parcela activa antes de programar la actividad.');
    }
  }
  askComplete(task:Entity){this.actionError.set('');this.action.set({kind:'complete',task});}
  askDelete(task:Entity){this.actionError.set('');this.action.set({kind:'delete',task});}
  askDeleteTemplate(template:Entity){this.actionError.set('');this.action.set({kind:'delete-template',task:template});}
  async confirmAction(){const item=this.action();if(!item||this.busy())return;this.busy.set(true);this.actionError.set('');this.notice.set('');
    try{if(item.kind==='delete-template'){await this.api.deleteTemplate(item.task.id);}else if(item.kind==='delete'){await this.api.deleteActivity(item.task.id);}else{const t=item.task;await this.api.save('activities',{title:t.title,plot_id:t.plot_id,date:t.date,category:t.category,notes:t.notes||'',status:'Completada'},t.id);}this.action.set(null);await this.load();this.notice.set(item.kind==='delete-template'?'Plantilla eliminada. Tus actividades programadas se conservaron.':item.kind==='delete'?'Actividad eliminada.':'¡Actividad completada! El progreso de tu campo se ha actualizado.');}
    catch(e){this.actionError.set(errorMessage(e));}finally{this.busy.set(false);}
  }
  async save(value:Record<string,unknown>){this.busy.set(true);this.formError.set('');try{const isTemplate=this.templateMode();await this.api.save(isTemplate?'templates':'activities',value,this.selected()?.id);this.editor.set(false);await this.load();this.notice.set(isTemplate?'Plantilla guardada correctamente.':'Actividad guardada en tu planificación.');}catch(e){this.formError.set(errorMessage(e));}finally{this.busy.set(false);}}
}
