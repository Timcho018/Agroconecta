import { Component, OnInit, inject, input, output, signal } from '@angular/core';
import { form, FormField, maxLength, minLength, required, validate } from '@angular/forms/signals';
import { Entity } from '../core/models';
import { FarmLocation, LocationPicker } from './location-picker';

const SOILS = ['No lo sé', 'Franco', 'Arenoso', 'Arcilloso', 'Limoso', 'Franco-arenoso', 'Franco-arcilloso', 'Otro'];

@Component({
  selector: 'agro-plot-editor',
  imports: [FormField, LocationPicker],
  template: `
    <div class="modal-backdrop" (click)="close()">
      <section class="modal plot-modal" role="dialog" aria-modal="true" aria-labelledby="plot-modal-title" (click)="$event.stopPropagation()" (keydown.escape)="close()">
        <header><div><span class="eyebrow">TU CUADERNO DE CAMPO</span><h2 id="plot-modal-title">{{current() ? 'Editar parcela' : 'Registrar mi parcela'}}</h2><p class="muted">Solo la información que necesitas. Tu ubicación se elige en un mapa.</p></div><button class="icon-button" type="button" [disabled]="busy()" aria-label="Cerrar" (click)="close()">×</button></header>
        <form (submit)="save($event)" novalidate>
          <div class="plot-editor-layout">
            <div class="plot-editor-details">
              <label>¿Cómo llamas a tu parcela? <span class="required">*</span>
                <input autofocus placeholder="Ej. La Esperanza" [formField]="fields.name" />
                @if(fields.name().touched()){ @for(issue of fields.name().errors();track $index){<small class="field-error">{{issue.message}}</small>} }
              </label>
              <label>Superficie en hectáreas <span class="required">*</span>
                <input type="text" inputmode="decimal" placeholder="Ej. 1,5" [formField]="fields.area" />
                <small>¿Media hectárea? Escribe 0,5. También puedes usar un punto decimal.</small>
                @if(fields.area().touched()){ @for(issue of fields.area().errors();track $index){<small class="field-error">{{issue.message}}</small>} }
              </label>
              <label>Cultivo <span class="muted">(opcional)</span>
                <select [formField]="fields.crop_id"><option value="">Todavía no asignado</option>@for(crop of crops();track crop.id){@if(crop.active !== false || crop.id === current()?.crop_id){<option [value]="crop.id">{{crop.name}}{{crop.variety ? ' · ' + crop.variety : ''}}</option>}}</select>
                <small>Si aún no lo registraste, puedes asignarlo más adelante.</small>
              </label>
              <label>Tipo de suelo <span class="muted">(opcional)</span>
                <select [formField]="fields.soil">@for(soil of soils;track soil){<option [value]="soil">{{soil}}</option>}</select>
                <small>No necesitas ser especialista. Puedes elegir «No lo sé».</small>
              </label>
              <label>Observaciones <span class="muted">(opcional)</span>
                <textarea rows="3" placeholder="Ej. Tiene riego por goteo, acceso por camino…" [formField]="fields.notes"></textarea>
              </label>
            </div>
            <div class="plot-editor-location">
              <agro-location-picker
                [initialLatitude]="current()?.latitude ?? null"
                [initialLongitude]="current()?.longitude ?? null"
                [initialLocation]="current()?.location ?? ''"
                (picked)="onPicked($event)" />
              @if(positionError()){<p class="field-error" role="alert">{{positionError()}}</p>}
            </div>
          </div>
          @if(error()){<p class="error" role="alert">{{error()}}</p>}
          <footer><button type="button" class="button ghost" [disabled]="busy()" (click)="close()">Cancelar</button><button type="submit" class="button" [disabled]="busy()">{{busy() ? 'Guardando parcela…' : current() ? 'Guardar cambios' : 'Registrar parcela'}}</button></footer>
        </form>
      </section>
    </div>
  `,
})
export class PlotEditor implements OnInit {
  current = input<Entity | null>(null);
  crops = input<Entity[]>([]);
  busy = input(false);
  error = input('');
  saved = output<Record<string, unknown>>();
  closed = output<void>();
  soils = SOILS;
  positionError = signal('');
  position = signal<FarmLocation | null>(null);
  model = signal({name:'',area:'',crop_id:'',soil:'No lo sé',notes:''});
  fields = form(this.model, p => {
    required(p.name, {message:'Escribe el nombre de tu parcela.'});
    minLength(p.name, 2, {message:'El nombre debe tener al menos dos letras.'});
    maxLength(p.name, 100, {message:'El nombre no debe superar los 100 caracteres.'});
    maxLength(p.notes, 2000, {message:'Las observaciones no deben superar los 2000 caracteres.'});
    required(p.area, {message:'Escribe cuántas hectáreas tiene tu parcela.'});
    validate(p.area, ({value}) => {
      const text = value().trim().replace(',', '.');
      const number = Number(text);
      return !text || !Number.isFinite(number) || number <= 0 || number > 100000
        ? {kind:'area',message:'Escribe una superficie válida, por ejemplo 0,5 o 2.'} : null;
    });
  });

  ngOnInit() {
    const c = this.current();
    if (c) {
      this.model.set({name:c.name,area:String(c.area),crop_id:c.crop_id||'',soil:c.soil||'No lo sé',notes:c.notes||''});
      this.position.set({latitude:c.latitude,longitude:c.longitude,location:c.location});
    }
  }
  onPicked(point: FarmLocation | null) { this.position.set(point); this.positionError.set(''); }
  save(event: Event) {
    event.preventDefault(); if (this.busy()) return;
    this.fields.name().markAsTouched(); this.fields.area().markAsTouched();
    const selected = this.position();
    if (!selected) this.positionError.set('Selecciona la ubicación en el mapa, mediante búsqueda o con el GPS.');
    if (this.fields().invalid() || !selected) return;
    const value = this.model();
    this.saved.emit({
      name: value.name.trim(), area: Number(value.area.trim().replace(',', '.')),
      crop_id: value.crop_id, soil: value.soil === 'No lo sé' ? '' : value.soil,
      notes: value.notes.trim(), location: selected.location,
      latitude: selected.latitude, longitude: selected.longitude,
    });
  }
  close() { if (!this.busy()) this.closed.emit(); }
}
