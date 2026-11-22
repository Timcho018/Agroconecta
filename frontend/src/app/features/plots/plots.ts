import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { Api, errorMessage } from '../../core/api';
import { Entity } from '../../core/models';
import { PlotEditor } from '../../shared/plot-editor';
import { Icon } from '../../shared/icon';

@Component({ selector: 'agro-plots', imports: [PlotEditor, Icon, DecimalPipe], styleUrl: './plots.scss', template: `
  <div class="page-heading"><div><span class="eyebrow">Territorio</span><h1>Mis parcelas<span>.</span></h1><p>Conoce cada rincón de tu campo y mantén su información al día.</p></div><button class="button" (click)="edit()"><agro-icon name="plus" /> Nueva parcela</button></div>
  <div class="toolbar"><label class="search"><span>⌕</span><input aria-label="Buscar parcelas" placeholder="Buscar por nombre o ubicación…" [value]="query()" (input)="query.set($any($event.target).value)" /></label><div class="tabs compact"><button [class.active]="!inactive()" (click)="inactive.set(false)">Activas</button><button [class.active]="inactive()" (click)="inactive.set(true)">Inactivas</button></div><span class="muted">{{filtered().length}} parcelas</span></div>
  @if(error()){<p class="error" role="alert">{{error()}}</p><button class="button ghost" (click)="load()">Reintentar</button>}
  @if(notice()){<p class="success" role="status">{{notice()}}</p>}
  @if(loading() && !plots().length){<div class="field-skeleton" role="status" aria-live="polite"><div></div><div></div><div></div><p>Preparando tus parcelas…</p></div>}
  <div class="plot-grid">@for(p of filtered(); track p.id){<article class="card plot-card"><div class="plot-cover" [class.no-photo]="!p.photo_version">@if(p.photo_version){<img [src]="'/api/plots/' + p.id + '/photo?v=' + p.photo_version" [alt]="p.name" loading="lazy" />}@else{<div class="plot-scenery" [attr.data-theme]="themeFor(p)" aria-hidden="true"><span class="scene-glow"></span><span class="scene-cloud scene-cloud-one"></span><span class="scene-cloud scene-cloud-two"></span><span class="scene-hill scene-hill-back"></span><span class="scene-hill scene-hill-front"></span><span class="scene-rows"></span><span class="scene-ornament">✦</span></div>}<span class="badge">{{p.active ? 'Activa' : 'Inactiva'}}</span><label class="photo-action" [attr.aria-label]="'Cambiar fotografía de ' + p.name">{{uploading() === p.id ? 'Subiendo…' : '＋ Foto'}}<input type="file" accept="image/jpeg,image/png,image/webp" [disabled]="!!uploading()" (change)="upload(p, $event)" /></label></div>
    <div class="plot-body"><span class="eyebrow">{{cropName(p.crop_id)}}</span><h2>{{p.name}}</h2><p class="muted">{{p.location}}</p><div class="plot-facts"><span><strong>{{p.area | number:'1.0-2'}} <small>ha</small></strong>Superficie</span><span><strong>{{p.soil || 'Sin registrar'}}</strong>Tipo de suelo</span></div><p class="coordinates">⌖ Ubicación guardada para consultar el clima</p>@if(p.notes){<p class="plot-notes">{{p.notes}}</p>}<footer><button class="text-link" (click)="edit(p)">Editar parcela ↗</button><button class="text-link muted" [disabled]="busy()" (click)="toggle(p)">{{p.active ? 'Desactivar' : 'Reactivar'}}</button></footer></div></article>}
  </div>
  @if(!loading() && !error() && !filtered().length){<section class="card empty"><agro-icon name="map" /><h2>{{query() ? 'No encontramos coincidencias.' : inactive() ? 'No hay parcelas inactivas.' : 'Aquí comienza tu campo digital.'}}</h2><p>Marca la ubicación en el mapa o usa el GPS; no necesitas saber de coordenadas. Añade la fotografía cuando quieras.</p>@if(!inactive()){<button class="button" (click)="edit()">Registrar mi primera parcela</button>}</section>}
  @if(editor()){<agro-plot-editor [current]="selected()" [crops]="crops()" [busy]="busy()" [error]="formError()" (saved)="save($event)" (closed)="editor.set(false)" />}
  @if(deactivateTarget(); as target){
    <div class="plot-confirm-backdrop" role="presentation">
      <section class="plot-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="plot-confirm-title" aria-describedby="plot-confirm-desc" (keydown.escape)="deactivateTarget.set(null)">
        <div class="plot-confirm-icon"><agro-icon name="map"/></div>
        <h2 id="plot-confirm-title">¿Desactivar {{target.name}}?</h2>
        <p id="plot-confirm-desc">La parcela dejará de aparecer entre las activas. Sus cultivos, labores e historial se conservarán y podrás reactivarla cuando quieras.</p>
        <div class="plot-confirm-actions"><button type="button" class="button ghost" [disabled]="busy()" (click)="deactivateTarget.set(null)">Cancelar</button><button type="button" class="button" [disabled]="busy()" (click)="confirmDeactivate()">{{busy()?'Guardando…':'Desactivar parcela'}}</button></div>
      </section>
    </div>
  }
` })
export class Plots implements OnInit {
  api = inject(Api);
  plots = signal<Entity[]>(this.api.peek<Entity[]>('plots') ?? []);
  crops = signal<Entity[]>(this.api.peek<Entity[]>('crops') ?? []);
  query = signal(''); inactive = signal(false); error = signal(''); notice = signal('');
  loading = signal(!this.api.peek<Entity[]>('plots'));
  busy = signal(false); uploading = signal(''); editor = signal(false);
  deactivateTarget = signal<Entity|null>(null);
  selected = signal<Entity | null>(null); formError = signal('');
  filtered = computed(() => this.plots().filter(p => p.active !== this.inactive() && `${p.name} ${p.location}`.toLocaleLowerCase().includes(this.query().toLocaleLowerCase())));
  ngOnInit() { void this.load(); }
  async load() {
    this.loading.set(!this.api.peek<Entity[]>('plots'));
    this.error.set('');
    try {
      const [plots, crops] = await Promise.all([this.api.list('plots'), this.api.list('crops')]);
      this.plots.set(plots); this.crops.set(crops);
    } catch(e) { this.error.set(errorMessage(e)); }
    finally { this.loading.set(false); }
  }
  cropName(id: string) { return this.crops().find(c => c.id === id)?.name || 'Cultivo por definir'; }
  themeFor(p: Entity): string {
    const key = (p.name || '') + ':' + (p.id || '');
    let h=0; for(let i=0;i<key.length;i++) h=(h*31+key.charCodeAt(i))>>>0;
    return ['valle','amanecer','terrazas','bosque'][h % 4];
  }

  edit(plot?: Entity) { this.selected.set(plot || null); this.formError.set(''); this.editor.set(true); }
  private apply(updated: Entity) {
    this.plots.update(items => items.some(item => item.id === updated.id)
      ? items.map(item => item.id === updated.id ? updated : item) : [...items, updated]);
  }
  async save(value: Record<string, unknown>) {
    this.busy.set(true); this.formError.set('');
    try {
      const updated = await this.api.save('plots', {...value, active: this.selected()?.active ?? true}, this.selected()?.id);
      this.apply(updated); this.editor.set(false); this.notice.set('Parcela guardada correctamente.');
    } catch(e) { this.formError.set(errorMessage(e)); }
    finally { this.busy.set(false); }
  }
  async toggle(plot: Entity) {
    if(plot.active){this.deactivateTarget.set(plot);return;}
    await this.changeActive(plot);
  }
  async confirmDeactivate(){
    const plot=this.deactivateTarget(); if(!plot)return;
    await this.changeActive(plot);
    if(!this.error())this.deactivateTarget.set(null);
  }
  private async changeActive(plot: Entity){
    this.busy.set(true);this.error.set('');
    try {
      const value = {name:plot.name, location:plot.location, area:plot.area,
        latitude:plot.latitude, longitude:plot.longitude, crop_id:plot.crop_id || '',
        soil:plot.soil || '', notes:plot.notes || '', active:!plot.active};
      this.apply(await this.api.save('plots', value, plot.id));
    } catch(e) { this.error.set(errorMessage(e)); }
    finally { this.busy.set(false); }
  }
  async upload(plot: Entity, event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0]; if (!file) return;
    if (file.size > 5*1024*1024) { this.error.set('La fotografía debe pesar como máximo 5 MB.'); input.value=''; return; }
    this.uploading.set(plot.id); this.error.set('');
    try {
      this.apply(await this.api.photo(plot.id, file));
      this.notice.set('Fotografía guardada. Se retiraron sus metadatos.');
    } catch(e) { this.error.set(errorMessage(e)); }
    finally { this.uploading.set(''); input.value=''; }
  }
}
