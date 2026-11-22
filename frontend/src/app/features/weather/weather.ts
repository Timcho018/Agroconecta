import { Component, OnInit, inject, signal, input, computed } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Api, errorMessage } from '../../core/api';
import { Entity, Forecast, ForecastDay } from '../../core/models';

@Component({
  selector: 'agro-weather', imports: [DatePipe, DecimalPipe, RouterLink],
  templateUrl: './weather.html', styleUrl: './weather.scss',
})
export class Weather implements OnInit {
  focusedIndex = signal(0);
  activeDay(days: ForecastDay[]) { return days[this.focusedIndex()] ?? days[0] ?? null; }
  weatherText(code: number | null) {
    if (code === 0 || code === 1) return 'Una jornada de cielo claro para tus labores.';
    if (code === 2) return 'Nubes y claros sobre tu terreno.';
    if (code === 3) return 'Cielo cubierto durante la jornada.';
    if (code === 45 || code === 48) return 'Ambiente de niebla sobre los cultivos.';
    if (code !== null && code >= 51 && code <= 57) return 'Se esperan precipitaciones ligeras.';
    if ([71,73,75,77,85,86].includes(code ?? -1)) return 'Se esperan condiciones de nieve.';
    if ([95,96,99].includes(code ?? -1)) return 'Condiciones de tormenta previstas.';
    if (code !== null && code >= 61 && code <= 82) return 'Precipitaciones previstas para este día.';
    return 'Revisa la evolución del tiempo en tu parcela.';
  }
  sceneSrc(code: number | null): string {
    const tone = this.sky(code).tone;
    return '/weather/' + (tone === 'unknown' ? 'cloud' : tone) + '.webp';
  }
  hasCoordinates(): boolean {
    const plot = this.selectedPlot();
    if (!plot) return false;
    const latitude = Number(plot.latitude);
    const longitude = Number(plot.longitude);
    return Number.isFinite(latitude) && Number.isFinite(longitude)
      && !(latitude === 0 && longitude === 0)
      && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;
  }
  mapUrl(): string {
    if (!this.hasCoordinates()) return 'https://www.openstreetmap.org/';
    const { latitude, longitude } = this.selectedPlot()!;
    return `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=15/${latitude}/${longitude}`;
  }
  weeklyRain(days: ForecastDay[]) { return days.slice(0,7).reduce((total,d) => total + (d.rain_mm ?? 0), 0); }
  rainHeight(mm: number | null, days: ForecastDay[]) { const peak = Math.max(0, ...days.slice(0,7).map(d=>d.rain_mm ?? 0)); return peak > 0 && (mm ?? 0) > 0 ? Math.max(8, ((mm ?? 0) / peak) * 100) : 0; }
  api = inject(Api); selectedPlot = computed(() => this.plots().find(p => p.id === this.selected())); compact = input(false); plots = signal<Entity[]>((this.api.peek<Entity[]>('plots')??[]).filter(p=>p.active)); selected = signal(''); forecast = signal<Forecast | null>(null); error = signal(''); loading = signal(true); private request = 0;
  sky(code: number | null) {
    if (code === 0 || code === 1) return {label: code === 0 ? 'Despejado' : 'Mayormente despejado', tone: 'clear'};
    if (code === 2) return {label: 'Parcialmente nublado', tone: 'mixed'};
    if (code === 3) return {label: 'Nublado', tone: 'cloud'};
    if (code === 45 || code === 48) return {label: 'Niebla', tone: 'cloud'};
    if ([71,73,75,77,85,86].includes(code ?? -1)) return {label: 'Nieve', tone: 'wet'};
    if ([95,96,99].includes(code ?? -1)) return {label: 'Tormenta', tone: 'wet'};
    if (code !== null && code >= 51 && code <= 57) return {label: 'Llovizna', tone: 'wet'};
    if ([61,63,65,66,67,80,81,82].includes(code ?? -1)) return {label: 'Lluvia', tone: 'wet'};
    return {label: 'Pronóstico diario', tone: 'unknown'};
  }
  async ngOnInit() {
    this.error.set('');
    this.loading.set(!this.api.peek<Entity[]>('plots'));
    try {
      const plots = (await this.api.list('plots')).filter(p => p.active);
      this.plots.set(plots);
      if (plots.length) await this.select(plots[0].id);
    } catch(e) { this.error.set(errorMessage(e)); }
    finally { this.loading.set(false); }
  }
  async select(id: string) { this.focusedIndex.set(0); this.selected.set(id); const preview=this.api.peek<Forecast>('weather/' + id); this.forecast.set(preview); this.error.set(''); const request = ++this.request; if (!id) { this.loading.set(false); return; } this.loading.set(!preview); try { const result = await this.api.cached<Forecast>('weather/' + id, 120000); if (request === this.request) this.forecast.set(result); } catch(e) { if (request === this.request) this.error.set(errorMessage(e)); } finally { if (request === this.request) this.loading.set(false); } }
}
