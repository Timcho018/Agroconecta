import { Component, OnInit, OnDestroy, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Api, Auth, errorMessage } from '../../core/api';
import { Summary, Entity } from '../../core/models';
import { Icon } from '../../shared/icon';
import { Weather } from '../weather/weather';

@Component({ selector: 'agro-dashboard', imports: [Icon, RouterLink, Weather, DecimalPipe, DatePipe], template: `
  <header class="overview-heading d-flex justify-content-between">
    <div><p>Vista general</p><h1>{{ greeting() }}, {{auth.user()?.name?.split(' ')?.[0]}}.</h1></div>
    <a routerLink="/reportes" class="text-link">Ver historial ↗</a>
  </header>
  @if(error()){<div class="error" role="alert">{{error()}} <button class="text-link" (click)="load()">Reintentar</button></div>}
  @if(loading() && !summary()){<section class="dashboard-initial-state" role="status" aria-live="polite"><span class="dashboard-loading-symbol"><agro-icon name="leaf"/></span><div><strong>Tu campo, en un solo lugar.</strong><p>Estamos recuperando la información reciente de tus parcelas y actividades.</p></div><a routerLink="/parcelas">Mis parcelas ↗</a></section>}
  @if(summary(); as s){
    <section class="day-lead" aria-label="Siguiente paso">
      <div>
        @if(!s.active_plots){
          <span>Primer paso</span><h2>Ubica tu primera parcela.</h2><p>Marca tu terreno en el mapa para consultar el clima y empezar a registrar labores.</p>
          <a routerLink="/parcelas">Registrar parcela <agro-icon name="arrow" /></a>
        }@else if(activities()[0]; as task){
          <span>Próxima labor pendiente</span><h2>{{task.title}}</h2><p>{{plotName(task.plot_id)}} · {{task.date | date:'d MMMM yyyy':'':'es'}}</p>
          <a routerLink="/planificacion">Abrir agenda <agro-icon name="arrow" /></a>
        }@else{
          <span>Planificación</span><h2>¿Qué toca en tu parcela?</h2><p>Elige una labor y reserva el día para hacerla.</p>
          <a routerLink="/planificacion">Programar una labor <agro-icon name="arrow" /></a>
        }
      </div>
    </section>
    <nav class="ledger d-grid" aria-label="Resumen de tu campo">
      <a routerLink="/parcelas"><span><agro-icon name="map" />Parcelas activas</span><strong>{{s.active_plots}}</strong><small>{{s.area | number:'1.0-2'}} ha registradas</small></a>
      <a routerLink="/planificacion"><span><agro-icon name="calendar" />Labores pendientes</span><strong>{{s.pending}}</strong><small>{{s.completed}} completadas</small></a>
      <a routerLink="/produccion"><span><agro-icon name="box" />Cosecha registrada</span><strong>{{s.harvest_kg | number:'1.0-2'}} <i>kg</i></strong><small>Ver lotes ↗</small></a>
    </nav>
  }
  <div class="dashboard-columns field-daily-grid">
    <section class="card field-agenda">
      <div class="section-head"><div><h2>Agenda de campo</h2></div><a routerLink="/planificacion" class="text-link">Ver agenda ↗</a></div>
      @for(task of activities();track task.id){<a class="activity-row" routerLink="/planificacion"><span class="date-tile"><strong>{{task.date | date:'dd'}}</strong><small>{{task.date | date:'MMM':'':'es'}}</small></span><div><strong>{{task.title}}</strong><small>{{plotName(task.plot_id)}} · {{task.category}}</small></div><span class="badge">{{task.status}}</span></a>}
      @if(!loading() && !error() && !activities().length){<div class="empty field-agenda-empty"><agro-icon name="calendar" /><h3>La agenda está despejada.</h3><p>Cuando programes una labor, aparecerá aquí para que no se te pase.</p><a routerLink="/planificacion" class="text-link">Organizar actividades ↗</a></div>}
      @if(loading() && !activities().length){<p class="loading" role="status">Preparando tus próximas labores…</p>}
    </section>
    <agro-weather [compact]="true" />
  </div>

` })
export class Dashboard implements OnInit, OnDestroy {
  api = inject(Api); auth = inject(Auth); summary = signal<Summary | null>(this.api.peek<Summary>('summary')); activities = signal<Entity[]>((this.api.peek<Entity[]>('activities')??[]).filter(t=>['Pendiente','En curso'].includes(t.status)).sort((a,b)=>a.date.localeCompare(b.date)).slice(0,5)); plots = signal<Entity[]>(this.api.peek<Entity[]>('plots') ?? []); error = signal(''); loading = signal(!this.api.peek<Summary>('summary'));
  private greetingTimer?: ReturnType<typeof setInterval>;
  private currentGreeting() { const hour = Number(new Intl.DateTimeFormat('en-GB', {hour:'2-digit',hourCycle:'h23',timeZone:'America/Lima'}).format(new Date())); return hour < 12 ? 'Buenos días' : hour < 19 ? 'Buenas tardes' : 'Buenas noches'; }
  greeting = signal(this.currentGreeting());
  ngOnInit() { this.greetingTimer = setInterval(() => this.greeting.set(this.currentGreeting()), 60000); void this.load(); }
  ngOnDestroy() { if(this.greetingTimer) clearInterval(this.greetingTimer); }
  async load() { this.error.set(''); this.loading.set(!this.summary());
    const results = await Promise.allSettled([
      this.api.cached<Summary>('summary', 90000).then(value=>this.summary.set(value)),
      this.api.list('activities').then(tasks=>this.activities.set(tasks.filter(t => ['Pendiente','En curso'].includes(t.status)).sort((a,b)=>a.date.localeCompare(b.date)).slice(0,5))),
      this.api.list('plots').then(plots=>this.plots.set(plots))
    ]);
    const failure=results.find(result=>result.status==='rejected');
    if(failure && failure.status==='rejected') this.error.set(errorMessage(failure.reason));
    this.loading.set(false);
  }
  plotName(id: string) { return this.plots().find(p => p.id === id)?.name || 'Parcela'; }
}
