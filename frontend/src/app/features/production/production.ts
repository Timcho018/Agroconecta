import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { Api, errorMessage } from '../../core/api';
import { Entity, peruToday } from '../../core/models';
import { Icon } from '../../shared/icon';
import { AgroDatePicker } from '../../shared/date-picker';

const palette = [
  {name:'Selección', icon:'check'}, {name:'Clasificación',icon:'inspect'},
  {name:'Lavado',icon:'rain'}, {name:'Fermentación',icon:'clipboard'},
  {name:'Secado',icon:'sun'}, {name:'Empaque',icon:'box'},
  {name:'Almacenamiento',icon:'warehouse'}, {name:'Despacho',icon:'truck'},
];
const legacy = ['Cosechado','Procesamiento','Secado','Almacenado','Cerrado'];

type Dialog = '' | 'harvest' | 'template' | 'stage' | 'detail';

@Component({selector:'agro-production',imports:[Icon,DatePipe,DecimalPipe,AgroDatePicker],styleUrl:'./production.scss',template:`
<div class="production-v11">
  <header class="production-heading">
    <div><span class="eyebrow">DE LA TIERRA AL DESTINO</span><h1>Cosecha y lotes<span>.</span></h1>
      <p>Cada cosecha tiene su historia. Organiza los procesos y conoce cuánto producto conservas en cada etapa.</p></div>
    <button class="button prod-new" (click)="createHarvest()"><agro-icon name="plus"/> Registrar cosecha</button>
  </header>

  @if(error()){<div class="error" role="alert">{{error()}} <button class="text-link" (click)="load()">Reintentar</button></div>}
  @if(notice()){<div class="prod-notice" role="status"><agro-icon name="check"/>{{notice()}}<button (click)="notice.set('')" aria-label="Cerrar aviso">×</button></div>}

  <section class="prod-overview" aria-label="Resumen de producción">
    <div class="prod-overview-main">
      <div class="prod-hero-stamp"><agro-icon name="harvest"/><span>CONTROL DE PRODUCCIÓN</span></div>
      <div class="prod-hero-caption"><span>Tu producción en un vistazo</span><h2>{{total() | number:'1.0-2'}} <small>kg</small></h2><p>Total registrado de todas tus cosechas</p></div>
      <div class="prod-hero-decoration" aria-hidden="true"><span></span><span></span><span></span></div>
    </div>
    <div class="prod-overview-mini"><span class="prod-mini-icon tone-gold"><agro-icon name="box"/></span><small>Producto registrado actualmente</small><strong>{{current() | number:'1.0-2'}} <em>kg</em></strong><span class="prod-mini-sub">De {{lots().length}} {{lots().length===1?'lote registrado':'lotes registrados'}}</span></div>
    <div class="prod-overview-mini"><span class="prod-mini-icon"><agro-icon name="workflow"/></span><small>Lotes en seguimiento</small><strong>{{openLots()}}</strong><span class="prod-mini-sub">{{closedLots()}} {{closedLots()===1?'lote cerrado':'lotes cerrados'}}</span></div>
  </section>

  <div class="prod-section-bar">
    <nav class="prod-switch" aria-label="Secciones de cosecha"><button [class.selected]="view()==='lots'" (click)="view.set('lots')"><agro-icon name="box"/> Mis lotes <span>{{lots().length}}</span></button><button [class.selected]="view()==='templates'" (click)="view.set('templates')"><agro-icon name="layers"/> Plantillas de procesos <span>{{processTemplates().length}}</span></button></nav>
    @if(view()==='lots'){
      <label class="prod-filter">Mostrar <select [value]="filter()" (change)="filter.set($any($event.target).value)"><option value="all">Todos los lotes</option><option value="open">En seguimiento</option><option value="closed">Finalizados</option></select></label>
    }@else{<button class="button ghost" (click)="createTemplate()"><agro-icon name="plus"/> Nueva plantilla</button>}
  </div>

  @if(loading()){<div class="prod-empty">Cargando tus lotes y procesos…</div>}
  @else if(view()==='lots'){
    @if(!filtered().length){<section class="prod-empty"><span class="prod-empty-art"><agro-icon name="harvest"/></span><h2>{{filter()==='all'?'Tu próxima cosecha comienza aquí':'Sin lotes en esta categoría'}}</h2><p>Registra lo que has cosechado y crea un recorrido de etapas a tu medida. Puedes aprovechar plantillas que guardes tú mismo.</p><button class="button" (click)="createHarvest()">Registrar mi primera cosecha</button></section>}
    <div class="prod-lot-grid">
      @for(lot of filtered();track lot.id){
        <article class="prod-lot">
          <div class="prod-lot-top"><span class="prod-lot-code">{{lot.code}}</span><span class="prod-lot-state" [class.done]="lot.stage==='Cerrado'"><i></i>{{lot.stage==='Cerrado'?'Finalizado':'En seguimiento'}}</span></div>
          <div class="prod-lot-title"><span class="prod-lot-emblem"><agro-icon name="harvest"/></span><div><small>{{plotName(lot.plot_id)}} · {{lot.date | date:'d MMM yyyy':'':'es'}}</small><h3>{{cropName(lot.crop_id)}}</h3></div></div>
          <div class="prod-lot-metrics"><div><small>Cantidad actual</small><strong>{{lot.current_quantity | number:'1.0-2'}} <em>kg</em></strong></div><div><small>Cosecha inicial</small><strong>{{lot.quantity | number:'1.0-2'}} <em>kg</em></strong></div></div>
          <div class="prod-lot-progress"><div class="prod-lot-progress-label"><span>Proceso del lote</span><b>{{completedCount(lot)}} / {{process(lot).length}} etapas</b></div><div class="prod-meter"><span [style.width.%]="progress(lot)"></span></div><div class="prod-lot-current"><agro-icon name="arrow"/> {{lot.stage}}</div></div>
          <footer><button type="button" class="prod-link" (click)="showDetail(lot)">Ver seguimiento <agro-icon name="arrow"/></button>@if(lot.stage!=='Cerrado'){<button type="button" class="prod-next" (click)="advance(lot)">Registrar etapa <agro-icon name="arrow"/></button>}@else{<span class="prod-finished"><agro-icon name="check"/> Finalizado</span>}</footer>
        </article>
      }
    </div>
  }@else{
    <div class="prod-template-intro"><div><span class="eyebrow">PROCESOS A TU MANERA</span><h2>Tu biblioteca de procesos</h2><p>Guarda las etapas que usas con frecuencia y reutilízalas cuando registres una nueva cosecha. Cada lote conserva su proceso aunque luego edites la plantilla.</p></div><div class="prod-intro-stamp"><agro-icon name="layers"/></div></div>
    @if(!processTemplates().length){<div class="prod-empty prod-empty-short"><span class="prod-empty-art"><agro-icon name="layers"/></span><h2>Una buena rutina merece una plantilla</h2><p>Crea un proceso propio, por ejemplo: selección → secado → almacenamiento. Después podrás aplicarlo a tus cosechas.</p><button class="button" (click)="createTemplate()">Diseñar mi primer proceso</button></div>}
    <div class="prod-template-grid">@for(t of processTemplates();track t.id){<article class="prod-template-card"><header><span class="prod-template-symbol"><agro-icon name="layers"/></span><span class="prod-template-number">{{(t.steps||[]).length}} etapas</span></header><h3>{{t.name}}</h3><div class="prod-steps-mini"><span>Cosecha</span>@for(step of t.steps||[];track step){<span>{{step}}</span>}<span>Cierre</span></div><footer><button (click)="useTemplate(t)">Usar proceso <agro-icon name="arrow"/></button><button (click)="editTemplate(t)" aria-label="Editar plantilla"><agro-icon name="edit"/></button><button (click)="askDeleteTemplate(t)" aria-label="Eliminar plantilla"><agro-icon name="trash"/></button></footer></article>}</div>
  }

  @if(dialog()==='harvest'||dialog()==='template'){
    <div class="prod-overlay" role="presentation"><section class="prod-modal prod-builder-modal" role="dialog" aria-modal="true" [attr.aria-label]="dialog()==='harvest'?'Registrar cosecha':'Diseñar plantilla'">
      <header class="prod-modal-header"><div><span class="eyebrow">TU CUADERNO DE CAMPO / PROCESOS</span><h2>{{dialog()==='harvest'?'Nueva cosecha':'Diseñar un proceso'}}</h2><p>{{dialog()==='harvest'?'Registra los datos y define el recorrido que seguirá tu lote.':'Combina y ordena las etapas que necesitas. Luego reutiliza este proceso.'}}</p></div><button class="prod-close" type="button" (click)="close()" aria-label="Cerrar">×</button></header>
      <div class="prod-builder-grid">
        <div class="prod-builder-main">
          @if(dialog()==='harvest'){
            <div class="prod-block-heading"><span class="prod-step-num">01</span><div><h3>Datos de tu cosecha</h3><p>¿Qué producto recogiste y en qué cantidad?</p></div></div>
            <div class="prod-form-grid">
              <label class="prod-full">Parcela cosechada <span class="required">*</span><select [value]="plotId()" (change)="plotId.set($any($event.target).value)"><option value="">Seleccionar parcela</option>@for(plot of plots();track plot.id){@if(plot.active){<option [value]="plot.id">{{plot.name}} · {{cropName(plot.crop_id)}}</option>}}</select></label>
              <label>Fecha de cosecha <span class="required">*</span><agro-date-picker label="Fecha de cosecha" [max]="today" [value]="date()" (valueChange)="date.set($event)" /></label>
              <label>Cantidad cosechada (kg) <span class="required">*</span><input type="number" min="0.001" step="0.001" max="100000000" [value]="quantity()" (input)="quantity.set(+$any($event.target).value)"></label>
              <label class="prod-full">Observaciones (opcional)<textarea rows="2" [value]="notes()" (input)="notes.set($any($event.target).value)" placeholder="Estado del producto, condiciones de cosecha…"></textarea></label>
            </div>
          }@else{
            <div class="prod-block-heading"><span class="prod-step-num">01</span><div><h3>Nombre de tu plantilla</h3><p>Elige un nombre que puedas reconocer después.</p></div></div>
            <label class="prod-template-name">Nombre del proceso <span class="required">*</span><input maxlength="100" [value]="templateName()" (input)="templateName.set($any($event.target).value)" placeholder="Ej. Proceso de café pergamino"></label>
          }
          <div class="prod-block-heading prod-builder-heading"><span class="prod-step-num">{{dialog()==='harvest'?'02':'02'}}</span><div><h3>Construye el recorrido</h3><p>Arrastra etapas desde la derecha, o toca una para añadirla. Puedes cambiar el orden.</p></div></div>
          @if(dialog()==='harvest'){
            <label class="prod-choose-template">Partir de una plantilla guardada <select [value]="templateChoice()" (change)="selectTemplate($any($event.target).value)"><option value="">Crear proceso personalizado</option>@for(t of processTemplates();track t.id){<option [value]="t.id">{{t.name}}</option>}</select></label>
          }
          <div class="prod-process-flow" (dragover)="dragOver($event)" (drop)="dropAt($event, steps().length)">
            <div class="prod-flow-fixed"><span class="prod-flow-point"><agro-icon name="harvest"/></span><div><strong>Cosecha</strong><small>Punto de partida</small></div><span class="prod-fixed-label">INICIO</span></div>
            @for(step of steps();track $index){<div class="prod-flow-step" draggable="true" (dragstart)="startDrag($event,'reorder',$index)" (dragover)="dragOver($event)" (drop)="dropAt($event,$index)"><span class="prod-flow-reorder" aria-hidden="true">⋮⋮</span><span class="prod-flow-order">{{$index+1}}</span><div class="prod-flow-label"><strong>{{step}}</strong><small>Etapa personalizada</small></div><div class="prod-flow-controls"><button type="button" [disabled]="$index===0" (click)="move($index,-1)" aria-label="Subir etapa">↑</button><button type="button" [disabled]="$index===steps().length-1" (click)="move($index,1)" aria-label="Bajar etapa">↓</button><button type="button" class="prod-remove" (click)="removeStep($index)" aria-label="Quitar etapa">×</button></div></div>}
            @if(!steps().length){<div class="prod-flow-empty">Añade una etapa desde la biblioteca. También puedes dejar el proceso en Cosecha → Cierre.</div>}
            <div class="prod-flow-fixed end"><span class="prod-flow-point"><agro-icon name="check"/></span><div><strong>Cierre del lote</strong><small>Fin del seguimiento</small></div><span class="prod-fixed-label">FINAL</span></div>
          </div>
        </div>
        <aside class="prod-stage-library"><div class="prod-library-title"><agro-icon name="layers"/><div><h3>Biblioteca de etapas</h3><p>Elige las que realmente haces.</p></div></div><div class="prod-palette">@for(item of palette;track item.name){<button type="button" draggable="true" (dragstart)="startDrag($event,'palette',item.name)" (click)="addStep(item.name)"><span><agro-icon [name]="item.icon"/></span>{{item.name}}<agro-icon name="plus"/></button>}</div><div class="prod-custom-stage"><label>¿No está tu etapa?<input maxlength="64" [value]="customStep()" (input)="customStep.set($any($event.target).value)" (keydown.enter)="addCustom($event)" placeholder="Escribir etapa nueva"></label><button type="button" (click)="addCustom()" [disabled]="!customStep().trim()" aria-label="Agregar etapa personalizada"><agro-icon name="plus"/></button></div><p class="prod-library-note">Las etapas son tuyas. No todas las cosechas requieren secado o procesamiento.</p></aside>
      </div>
      @if(formError()){<div class="error" role="alert">{{formError()}}</div>}
      <footer class="prod-modal-footer"><span><agro-icon name="check"/> {{steps().length+2}} etapas en total</span><div><button class="button ghost" (click)="close()" [disabled]="busy()">Cancelar</button><button class="button" (click)="saveBuilder()" [disabled]="busy()"><agro-icon name="check"/> {{busy()?'Guardando…':dialog()==='harvest'?'Registrar cosecha':'Guardar plantilla'}}</button></div></footer>
    </section></div>
  }

  @if(dialog()==='stage' && selected()){
    <div class="prod-overlay"><section class="prod-modal prod-stage-modal" role="dialog" aria-modal="true" aria-label="Registrar etapa del lote"><header class="prod-modal-header"><div><span class="eyebrow">{{selected()!.code}} / SIGUIENTE ETAPA</span><h2>{{nextStage(selected()!)}}</h2><p>Registra cuánto producto queda después de completar esta etapa.</p></div><button type="button" class="prod-close" (click)="close()" aria-label="Cerrar">×</button></header><div class="prod-stage-quantity"><div><small>Peso anterior</small><strong>{{selected()!.current_quantity | number:'1.0-2'}} kg</strong></div><agro-icon name="arrow"/><div><small>Peso que queda</small><label><input type="number" min="0" [max]="selected()!.current_quantity" step="0.001" [value]="stageQuantity()" (input)="stageQuantity.set(+$any($event.target).value)" aria-label="Peso que queda"></label></div></div><div class="prod-loss-hint"><agro-icon name="info"/> {{stageLoss() | number:'1.0-2'}} kg de diferencia respecto de la etapa anterior. No puedes aumentar el peso sin registrar una nueva cosecha.</div><label>Observaciones de esta etapa<textarea rows="3" [value]="stageNotes()" (input)="stageNotes.set($any($event.target).value)" placeholder="¿Qué ocurrió durante esta etapa?"></textarea></label>@if(formError()){<p class="error" role="alert">{{formError()}}</p>}<footer class="prod-modal-footer"><button class="button ghost" (click)="close()">Cancelar</button><button class="button" [disabled]="busy()" (click)="saveStage()">{{busy()?'Guardando…':nextStage(selected()!)==='Cerrado'?'Cerrar lote':'Confirmar etapa'}} <agro-icon name="check"/></button></footer></section></div>
  }

  @if(dialog()==='detail' && selected()){
    <div class="prod-overlay"><section class="prod-modal prod-detail-modal" role="dialog" aria-modal="true" aria-label="Seguimiento del lote"><header class="prod-modal-header"><div><span class="eyebrow">{{selected()!.code}} · {{plotName(selected()!.plot_id)}}</span><h2>{{cropName(selected()!.crop_id)}}</h2><p>Recorrido del lote desde la cosecha hasta su cierre.</p></div><button class="prod-close" (click)="close()" aria-label="Cerrar">×</button></header><div class="prod-detail-summary"><div><small>Cosecha inicial</small><strong>{{selected()!.quantity | number:'1.0-2'}} kg</strong></div><div><small>Cantidad actual</small><strong>{{selected()!.current_quantity | number:'1.0-2'}} kg</strong></div><div><small>Diferencia acumulada</small><strong>{{loss(selected()!) | number:'1.0-2'}} kg</strong></div></div><div class="prod-detail-timeline">@for(step of process(selected()!);track $index){<div class="prod-timeline-node" [class.done]="$index < completedCount(selected()!)" [class.upcoming]="$index >= completedCount(selected()!)"><span class="prod-timeline-marker">@if($index < completedCount(selected()!)){<agro-icon name="check"/>}@else{<span>{{ $index + 1 }}</span>}</span><div><strong>{{step}}</strong>@if(stepEvent(selected()!,step);as e){<small>{{e.date | date:'d MMM yyyy, HH:mm':'-0500':'es'}} · {{e.quantity | number:'1.0-2'}} kg</small>@if(e.notes){<p>{{e.notes}}</p>}}@else{<small>Pendiente de registrar</small>}</div></div>}</div><footer class="prod-modal-footer"><button class="button ghost" (click)="close()">Cerrar</button>@if(selected()!.stage!=='Cerrado'){<button class="button" (click)="advance(selected()!)">Registrar siguiente etapa <agro-icon name="arrow"/></button>}</footer></section></div>
  }

  @if(deleteTarget()){
    <div class="prod-overlay"><section class="prod-modal prod-confirm" role="alertdialog" aria-modal="true" aria-label="Confirmar eliminación de plantilla"><span class="prod-danger-symbol"><agro-icon name="trash"/></span><h2>¿Eliminar esta plantilla?</h2><p>Se eliminará <strong>{{deleteTarget()!.name}}</strong> de tu biblioteca, pero las cosechas que ya la utilizaron conservarán sus etapas y su historial.</p>@if(formError()){<p class="error">{{formError()}}</p>}<footer class="prod-modal-footer"><button class="button ghost" (click)="deleteTarget.set(null)">Conservar</button><button class="button prod-danger" [disabled]="busy()" (click)="deleteTemplate()">Eliminar plantilla</button></footer></section></div>
  }
</div>
`})
export class Production implements OnInit {
  api=inject(Api);
  lots=signal<Entity[]>(this.api.peek<Entity[]>('harvests')??[]);plots=signal<Entity[]>(this.api.peek<Entity[]>('plots')??[]);crops=signal<Entity[]>(this.api.peek<Entity[]>('crops')??[]);templates=signal<Entity[]>(this.api.peek<Entity[]>('templates')??[]);
  error=signal('');notice=signal('');formError=signal('');loading=signal(!this.api.peek<Entity[]>('harvests'));busy=signal(false);
  view=signal<'lots'|'templates'>('lots');filter=signal('all');dialog=signal<Dialog>('');selected=signal<Entity|null>(null);
  editingTemplate=signal<Entity|null>(null);deleteTarget=signal<Entity|null>(null);
  plotId=signal('');date=signal(peruToday());quantity=signal(0);notes=signal('');
  templateName=signal('');templateChoice=signal('');steps=signal<string[]>([]);customStep=signal('');
  stageQuantity=signal(0);stageNotes=signal('');
  readonly today=peruToday();readonly palette=palette;
  private dragging: {type:'palette'|'reorder',value:string|number}|null=null;
  total=computed(()=>this.lots().reduce((n,l)=>n+l.quantity,0));
  current=computed(()=>this.lots().reduce((n,l)=>n+l.current_quantity,0));
  openLots=computed(()=>this.lots().filter(l=>l.stage!=='Cerrado').length);
  closedLots=computed(()=>this.lots().filter(l=>l.stage==='Cerrado').length);
  filtered=computed(()=>[...this.lots()].filter(l=>this.filter()==='all'||(this.filter()==='closed'?l.stage==='Cerrado':l.stage!=='Cerrado')).sort((a,b)=>(b.created_at||b.date).localeCompare(a.created_at||a.date)));
  processTemplates=computed(()=>this.templates().filter(t=>t.purpose==='harvest'));
  stageLoss=computed(()=>Math.max(0,(this.selected()?.current_quantity||0)-this.stageQuantity()));
  ngOnInit(){void this.load();}
  async load(){this.error.set('');this.loading.set(!this.api.peek<Entity[]>('harvests'));try{const [lots,plots,crops,templates]=await Promise.all([this.api.list('harvests'),this.api.list('plots'),this.api.list('crops'),this.api.list('templates')]);this.lots.set(lots);this.plots.set(plots);this.crops.set(crops);this.templates.set(templates);}catch(e){this.error.set(errorMessage(e));}finally{this.loading.set(false);}}
  plotName(id:string){return this.plots().find(p=>p.id===id)?.name||'Parcela';}
  cropName(id:string){const crop=this.crops().find(p=>p.id===id);return crop?.name || 'Cosecha sin cultivo asignado';}
  process(lot:Entity){return lot.process_steps?.length ? lot.process_steps : legacy;}
  completedCount(lot:Entity){return Math.min(lot.stages?.length||1,this.process(lot).length);}
  progress(lot:Entity){return Math.round(100*this.completedCount(lot)/this.process(lot).length);}
  nextStage(lot:Entity){const steps=this.process(lot);return steps[steps.indexOf(lot.stage)+1]||'Cerrado';}
  loss(lot:Entity){return Math.max(0,lot.quantity-lot.current_quantity);}
  stepEvent(lot:Entity,step:string){return lot.stages?.find(e=>e.stage===step);}
  close(){if(!this.busy()){this.dialog.set('');this.formError.set('');}}
  createHarvest(){this.formError.set('');this.selected.set(null);this.plotId.set(this.plots().filter(p=>p.active)[0]?.id||'');this.date.set(this.today);this.quantity.set(0);this.notes.set('');this.templateChoice.set('');this.steps.set([]);this.customStep.set('');this.dialog.set('harvest');}
  createTemplate(){this.formError.set('');this.editingTemplate.set(null);this.templateName.set('');this.steps.set([]);this.customStep.set('');this.dialog.set('template');}
  editTemplate(t:Entity){this.formError.set('');this.editingTemplate.set(t);this.templateName.set(t.name);this.steps.set([...(t.steps||[])]);this.dialog.set('template');}
  useTemplate(t:Entity){this.createHarvest();this.selectTemplate(t.id);}
  selectTemplate(id:string){this.templateChoice.set(id);const t=this.processTemplates().find(t=>t.id===id);this.steps.set(t?[...(t.steps||[])]:[]);}
  addStep(value:string){const name=value.trim();this.formError.set('');if(name.length<2||name.length>64){this.formError.set('El nombre de la etapa debe tener entre 2 y 64 caracteres.');return;}if(this.steps().length>=10){this.formError.set('Puedes usar hasta 10 etapas intermedias.');return;}if(['cosechado','cerrado'].includes(name.toLowerCase())||this.steps().some(s=>s.toLowerCase()===name.toLowerCase())){this.formError.set('Esta etapa ya está en el proceso.');return;}this.steps.update(items=>[...items,name]);}
  addCustom(event?:Event){event?.preventDefault();const label=this.customStep().trim();if(label){this.addStep(label);if(this.steps().includes(label))this.customStep.set('');}}
  removeStep(index:number){this.steps.update(items=>items.filter((_,i)=>i!==index));this.templateChoice.set('');}
  move(index:number,delta:number){const next=index+delta;const items=[...this.steps()];if(next<0||next>=items.length)return;[items[index],items[next]]=[items[next],items[index]];this.steps.set(items);this.templateChoice.set('');}
  startDrag(event:DragEvent,type:'palette'|'reorder',value:string|number){this.dragging={type,value};event.dataTransfer?.setData('text/plain',String(value));if(event.dataTransfer)event.dataTransfer.effectAllowed='move';}
  dragOver(event:DragEvent){event.preventDefault();if(event.dataTransfer)event.dataTransfer.dropEffect='move';}
  dropAt(event:DragEvent,index:number){event.preventDefault();event.stopPropagation();const drag=this.dragging;this.dragging=null;if(!drag)return;if(drag.type==='palette'){const before=this.steps().length;this.addStep(String(drag.value));if(this.steps().length>before && index<before){const items=[...this.steps()];const moved=items.pop()!;items.splice(index,0,moved);this.steps.set(items);}}else{const from=Number(drag.value);const items=[...this.steps()];if(from>=0&&from<items.length){const [moved]=items.splice(from,1);items.splice(Math.min(index,items.length),0,moved);this.steps.set(items);}}this.templateChoice.set('');}
  async saveBuilder(){this.formError.set('');if(this.dialog()==='harvest'){
      if(!this.plotId()){this.formError.set('Selecciona la parcela de la cosecha.');return;}
      if(!this.date()||this.date()>this.today){this.formError.set('Selecciona una fecha válida, no futura.');return;}
      if(!Number.isFinite(this.quantity())||this.quantity()<=0||this.quantity()>100000000){this.formError.set('Escribe la cantidad real cosechada en kilogramos.');return;}
    }else if(this.templateName().trim().length<2 || !this.steps().length){this.formError.set('Escribe el nombre de la plantilla y añade al menos una etapa.');return;}
    this.busy.set(true);try{if(this.dialog()==='harvest'){
      await this.api.save('harvests',{plot_id:this.plotId(),date:this.date(),quantity:this.quantity(),notes:this.notes(),process_steps:[...this.steps()],process_template_id:this.templateChoice()||''});
      this.notice.set('Cosecha registrada. Ya puedes seguir cada etapa de tu lote.');this.view.set('lots');
    }else{
      const name=this.templateName().trim();await this.api.save('templates',{name,title:name,purpose:'harvest',steps:[...this.steps()],category:'Poscosecha',notes:''},this.editingTemplate()?.id);
      this.notice.set(this.editingTemplate()?'Plantilla actualizada. Los lotes anteriores conservan su proceso.':'Plantilla guardada y lista para reutilizar.');this.view.set('templates');
    }this.dialog.set('');await this.load();}catch(e){this.formError.set(errorMessage(e));}finally{this.busy.set(false);}}
  showDetail(lot:Entity){this.selected.set(lot);this.dialog.set('detail');this.formError.set('');}
  advance(lot:Entity){this.selected.set(lot);this.stageQuantity.set(lot.current_quantity);this.stageNotes.set('');this.formError.set('');this.dialog.set('stage');}
  async saveStage(){const lot=this.selected();if(!lot)return;const amount=this.stageQuantity();if(!Number.isFinite(amount)||amount<0||amount>lot.current_quantity){this.formError.set('Introduce un peso entre cero y la cantidad actual del lote.');return;}this.busy.set(true);this.formError.set('');try{await this.api.post(`harvests/${lot.id}/stages`,{stage:this.nextStage(lot),quantity:amount,notes:this.stageNotes()});this.api.invalidate('harvests');this.dialog.set('');this.notice.set('Etapa registrada y cantidad actualizada.');await this.load();}catch(e){this.formError.set(errorMessage(e));}finally{this.busy.set(false);}}
  askDeleteTemplate(t:Entity){this.formError.set('');this.deleteTarget.set(t);}
  async deleteTemplate(){const t=this.deleteTarget();if(!t)return;this.busy.set(true);this.formError.set('');try{await this.api.deleteTemplate(t.id);this.deleteTarget.set(null);this.notice.set('Plantilla eliminada. Los lotes existentes no se modificaron.');await this.load();}catch(e){this.formError.set(errorMessage(e));}finally{this.busy.set(false);}}
}
