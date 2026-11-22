import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideHttpClient } from '@angular/common/http';
import { registerLocaleData } from '@angular/common';
import localeEs from '@angular/common/locales/es';
import { routes } from './app.routes';
import { Auth, Api } from './core/api';
import { Editor } from './shared/editor';
import { Planning } from './features/planning/planning';
import { reportMonthKeys } from './features/reports/metrics';

registerLocaleData(localeEs);

describe('Acceso y rutas', () => {
  beforeEach(() => TestBed.configureTestingModule({
    providers: [provideRouter(routes), provideHttpClient(), { provide: Auth, useValue: { restore: async () => false } }],
  }));
  it('protege las rutas de campo', async () => {
    await RouterTestingHarness.create('/parcelas');
    expect(TestBed.inject(Router).url).toBe('/acceso');
  });
  it('ofrece un formulario de acceso en español', async () => {
    const harness = await RouterTestingHarness.create('/acceso');
    expect(harness.routeNativeElement?.textContent).toContain('Qué bueno verte.');
    expect(harness.routeNativeElement?.querySelector('input[type="password"]')).toBeTruthy();
  });
});

describe('Signal Forms reutilizables', () => {
  it('muestra un solo error obligatorio y rechaza espacios como cantidad', () => {
    const fixture = TestBed.createComponent(Editor);
    fixture.componentRef.setInput('title', 'Cosecha');
    fixture.componentRef.setInput('fields', [{ key: 'quantity', label: 'Cantidad', type: 'number', required: true, min: 0.001 }]);
    fixture.detectChanges();
    const editor = fixture.componentInstance;
    const values: unknown[] = [];
    editor.saved.subscribe(value => values.push(value));
    editor.save(new Event('submit'));
    expect(editor.fieldsForm['quantity']().errors().map(error => error.kind)).toEqual(['required']);
    editor.model.set({ quantity: '   ' });
    editor.save(new Event('submit'));
    expect(values).toHaveLength(0);
    expect(editor.fieldsForm().invalid()).toBe(true);
  });

  it('bloquea valores fuera de rango y entrega números normalizados', async () => {
    const fixture = TestBed.createComponent(Editor);
    fixture.componentRef.setInput('title', 'Parcela');
    fixture.componentRef.setInput('fields', [{ key: 'area', label: 'Superficie', type: 'number', required: true, min: 0.01, max: 100 }]);
    fixture.detectChanges();
    const editor = fixture.componentInstance;
    const values: unknown[] = [];
    editor.saved.subscribe(value => values.push(value));
    editor.model.set({ area: '-1' });
    editor.save(new Event('submit'));
    expect(values).toHaveLength(0);
    editor.model.set({ area: '2.5' });
    editor.save(new Event('submit'));
    expect(values).toEqual([{ area: 2.5 }]);
  });
  it('no envía dos veces mientras está guardando', () => {
    const fixture = TestBed.createComponent(Editor);
    fixture.componentRef.setInput('title', 'Cultivo');
    fixture.componentRef.setInput('fields', [{ key: 'name', label: 'Nombre', required: true }]);
    fixture.componentRef.setInput('initial', { name: 'Café' });
    fixture.componentRef.setInput('busy', true);
    fixture.detectChanges();
    const values: unknown[] = [];
    fixture.componentInstance.saved.subscribe(value => values.push(value));
    fixture.componentInstance.save(new Event('submit'));
    expect(values).toHaveLength(0);
  });
});

describe('Calendario y exportación', () => {
  it('incluye el día bisiesto y cambia de año correctamente', () => {
    TestBed.configureTestingModule({ providers: [{ provide: Api, useValue: { list: async () => [], peek: () => null } }] });
    const page = TestBed.createComponent(Planning).componentInstance;
    page.month.set('2028-02');
    expect(page.days().filter(day => day.current)).toHaveLength(29);
    expect(page.days().some(day => day.date === '2028-02-29')).toBe(true);
    page.month.set('2026-12');
    page.move(1);
    expect(page.month()).toBe('2027-01');
  });
  it('muestra los meses del período elegido, incluso en años anteriores', () => {
    expect(reportMonthKeys('2023-01-01','2023-03-31','2026-11-22')).toEqual(['2023-01','2023-02','2023-03']);
    expect(reportMonthKeys('2026-12-01','2026-11-30','2026-11-22')).toEqual([]);
    expect(reportMonthKeys('','','2026-11-22')).toEqual(['2026-06','2026-07','2026-08','2026-09','2026-10','2026-11']);
  });
});
