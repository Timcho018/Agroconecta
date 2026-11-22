import { Component, ElementRef, Injector, OnInit, afterNextRender, inject, input, output, signal } from '@angular/core';
import { form, FormField, required, email, minLength, validate, FieldTree } from '@angular/forms/signals';
import { FieldSpec } from '../core/models';
import { AgroDatePicker } from './date-picker';

@Component({
  selector: 'agro-editor', imports: [FormField, AgroDatePicker],
  template: `
    <div class="modal-backdrop" (click)="dismiss()">
      <section class="modal" role="dialog" aria-modal="true" aria-labelledby="editor-title" (click)="$event.stopPropagation()" (keydown.escape)="dismiss()" (keydown.tab)="trap($event)">
        <header><div><span class="eyebrow">TU CUADERNO DE CAMPO</span><h2 id="editor-title">{{ title() }}</h2></div><button class="icon-button" aria-label="Cerrar" [disabled]="busy()" (click)="dismiss()">×</button></header>
          <form (submit)="save($event)" novalidate>
            <div class="form-grid">
              @for (field of fields(); track field.key) {
                <label [class.wide]="field.type === 'textarea'">{{ field.label }} @if(field.required){<span class="required">*</span>}
                  @if (field.type === 'select') { <select [formField]="fieldsForm[field.key]"><option value="">Seleccionar</option>@for(option of field.options; track option.value){<option [value]="option.value">{{ option.label }}</option>}</select> }
                  @else if (field.type === 'date') { <agro-date-picker [label]="field.label" [value]="model()[field.key]" (valueChange)="updateDate(field.key,$event)" /> }
                  @else if (field.type === 'textarea') { <textarea rows="3" [formField]="fieldsForm[field.key]"></textarea> }
                  @else { <input [type]="field.type === 'number' ? 'text' : (field.type || 'text')" [attr.inputmode]="field.type === 'number' ? 'decimal' : null" [formField]="fieldsForm[field.key]" [attr.list]="field.suggestions?.length ? 'suggest-' + field.key : null" [attr.autocomplete]="field.type === 'password' ? 'new-password' : null" /> }
                  @if(field.suggestions?.length){<datalist [id]="'suggest-' + field.key">@for(option of field.suggestions;track option){<option [value]="option"></option>}</datalist>}
                  @if(field.hint){<small>{{ field.hint }}</small>}
                  @if(fieldsForm[field.key]().touched()) { @for(error of fieldsForm[field.key]().errors(); track $index){<small class="field-error">{{ error.message }}</small>} }
                </label>
              }
            </div>
            @if(error()){<p class="error" role="alert">{{ error() }}</p>}
            <footer><button type="button" class="button ghost" [disabled]="busy()" (click)="dismiss()">Cancelar</button><button class="button" type="submit" [disabled]="busy()">{{ busy() ? 'Guardando…' : 'Guardar cambios' }}</button></footer>
          </form>
      </section>
    </div>
  `,
})
export class Editor implements OnInit {
  title = input.required<string>(); fields = input.required<FieldSpec[]>(); initial = input<Record<string, unknown>>({});
  busy = input(false); error = input(''); saved = output<Record<string, unknown>>(); closed = output<void>();
  model = signal<Record<string, string>>({}); fieldsForm!: FieldTree<Record<string, string>>;
  private injector = inject(Injector);
  private host = inject<ElementRef<HTMLElement>>(ElementRef); private previous = document.activeElement as HTMLElement | null;
  constructor() { afterNextRender(() => this.host.nativeElement.querySelector<HTMLInputElement>('input,select,textarea')?.focus()); }
  ngOnInit() {
    this.model.set(Object.fromEntries(this.fields().map(f => [f.key, String(this.initial()[f.key] ?? '')])));
    this.fieldsForm = form(this.model, path => {
      for (const field of this.fields()) {
        if (field.required) required(path[field.key], { message: 'Este campo es obligatorio.' });
        if (field.type === 'email') email(path[field.key], { message: 'Escribe un correo válido.' });
        if (field.minLength) minLength(path[field.key], field.minLength, { message: `Usa al menos ${field.minLength} caracteres.` });
        if (field.type === 'number') validate(path[field.key], ({ value }) => {
          // Required handles the empty string; whitespace must not become a valid zero.
          if (value() === '' || (!field.required && !value().trim())) return null;
          const n = Number(value().trim().replace(',', '.'));
          return !value().trim() || !Number.isFinite(n) || (field.min !== undefined && n < field.min) || (field.max !== undefined && n > field.max) || (field.integer && !Number.isInteger(n))
            ? { kind: 'number', message: `Escribe un número entre ${field.min ?? '−∞'} y ${field.max ?? '∞'}. Puedes usar coma o punto decimal.` } : null;
        });
      }
    }, { injector: this.injector });
  }
  updateDate(key:string, value:string){ this.model.update(current=>({...current,[key]:value})); this.fieldsForm[key]().markAsTouched(); }
  save(event: Event) {
    event.preventDefault(); if (this.busy()) return;
    for (const f of this.fields()) this.fieldsForm[f.key]().markAsTouched();
    if (this.fieldsForm().invalid()) return;
    this.saved.emit(Object.fromEntries(this.fields().map(f => [f.key, f.type === 'number' ? Number((this.model()[f.key] || '0').replace(',', '.')) : this.model()[f.key].trim()])));
  }
  dismiss() { if (!this.busy()) { this.closed.emit(); this.previous?.focus(); } }
  trap(event: Event) {
    const e = event as KeyboardEvent;
    const elements = Array.from(this.host.nativeElement.querySelectorAll<HTMLElement>('button:not(:disabled),input,select,textarea'));
    const first = elements[0], last = elements.at(-1);
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
    if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
  }
}
