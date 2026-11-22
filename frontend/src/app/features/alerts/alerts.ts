import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api, errorMessage } from '../../core/api';
import { Alerts as AlertResponse } from '../../core/models';
import { Icon } from '../../shared/icon';

@Component({selector:'agro-alerts',imports:[RouterLink,Icon],template:`
  <div class="page-heading"><div><span class="eyebrow">Seguimiento</span><h1>Alertas y seguimiento<span>.</span></h1><p>Señales para revisar tu agenda y las condiciones de tu campo.</p></div><button class="button ghost" [disabled]="loading()" (click)="load(true)">{{loading() ? 'Consultando…' : 'Actualizar avisos'}}</button></div>
  @if(error()){<p class="error" role="alert">{{error()}}</p>}
  @if(loading() && !data()){<section class="card empty" role="status"><agro-icon name="sun" /><h2>Revisando tus registros y el pronóstico.</h2><p>La consulta a Open-Meteo puede tardar unos segundos.</p></section>}
  @if(data();as result){<p class="info">{{result.rule}}</p>@if(result.unavailable.length){<p class="error">No pudimos comprobar el clima en: {{result.unavailable.join(', ')}}. Los avisos meteorológicos están incompletos.</p>}
    <div class="alert-list">@for(alert of result.items;track alert.id){<article class="card alert-card" [class.alert-reviewed]="alert.reviewed"><span class="alert-icon"><agro-icon [name]="alert.type==='Pronóstico' ? 'rain' : 'calendar'" /></span><div class="grow"><span class="eyebrow">{{alert.type}} @if(alert.reviewed){ · Revisada}</span><h2>{{alert.title}}</h2><p>{{alert.detail}}</p></div><div class="alert-actions"><a class="button ghost" [routerLink]="alert.type==='Pronóstico' ? '/clima' : '/planificacion'">Consultar ↗</a><button class="button ghost" [disabled]="saving()===alert.id" (click)="toggle(alert.id, !alert.reviewed)">{{saving()===alert.id ? 'Guardando…' : alert.reviewed ? 'Marcar pendiente' : 'Marcar revisada'}}</button></div></article>}</div>
    @if(!result.items.length&&!loading()){<section class="card empty"><agro-icon name="check" /><h2>{{result.unavailable.length ? 'Sin avisos en los registros comprobados.' : 'Todo al día en tus registros.'}}</h2><p>{{result.unavailable.length ? 'Queda pendiente verificar el pronóstico.' : 'No encontramos coincidencias con las reglas de aviso. Mantén tus actividades y lotes actualizados.'}}</p><a routerLink="/planificacion" class="text-link">Ver planificación →</a></section>}
  }
`})
export class Alerts implements OnInit {
  api=inject(Api);data=signal<AlertResponse|null>(this.api.peek<AlertResponse>('alerts'));loading=signal(!this.api.peek<AlertResponse>('alerts'));saving=signal('');error=signal('');ngOnInit(){void this.load();}
  async load(force=false){if(force)this.api.invalidate('alerts');this.loading.set(!this.data());this.error.set('');try{this.data.set(await this.api.cached<AlertResponse>('alerts', 90000));}catch(e){this.error.set(errorMessage(e));}finally{this.loading.set(false);}}
  async toggle(id:string,reviewed:boolean){
    if(this.saving())return;
    this.saving.set(id);this.error.set('');
    try{
      await this.api.put(`alerts/${encodeURIComponent(id)}/review`,{reviewed});
      this.api.invalidate('alerts');
      this.data.update(current=>current ? {...current,items:current.items.map(item=>item.id===id ? {...item,reviewed}:item)} : current);
    }catch(e){this.error.set(errorMessage(e));}
    finally{this.saving.set('');}
  }
}
