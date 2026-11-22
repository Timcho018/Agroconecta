import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild, inject, input, output, signal } from '@angular/core';
import { Api, errorMessage } from '../core/api';

// Leaflet se carga bajo demanda al abrir el formulario, no al iniciar Angular.
// Así un servidor de mapas inaccesible jamás bloquea la pantalla de inicio.
declare const L: any;
let leafletPromise: Promise<void> | null = null;
function loadLeaflet(): Promise<void> {
  if (typeof L !== 'undefined') return Promise.resolve();
  if (leafletPromise) return leafletPromise;
  leafletPromise = new Promise<void>((resolve, reject) => {
    if (!document.querySelector('link[data-agro-leaflet]')) {
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      css.setAttribute('data-agro-leaflet', '');
      document.head.appendChild(css);
    }
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.async = true;
    const finish = (error?: Error) => {
      clearTimeout(watchdog);
      if (error) { script.remove(); leafletPromise = null; reject(error); }
      else resolve();
    };
    const watchdog = setTimeout(() => finish(new Error('El mapa tardó demasiado en cargar.')), 8500);
    script.onload = () => typeof L === 'undefined'
      ? finish(new Error('El mapa no está disponible.')) : finish();
    script.onerror = () => finish(new Error('No se pudieron descargar los mapas.'));
    document.head.appendChild(script);
  });
  return leafletPromise;
}
export interface FarmLocation { latitude: number; longitude: number; location: string }
interface PlaceResult { name: string; label: string; latitude: number; longitude: number }

@Component({
  selector: 'agro-location-picker',
  template: `
    <section class="location-picker" aria-labelledby="plot-map-label">
      <div class="location-picker-heading">
        <div><strong id="plot-map-label">¿Dónde queda tu parcela?</strong><p>Busca tu localidad o toca el mapa para marcar el terreno.</p></div>
        <button type="button" class="button ghost gps-button" (click)="useGps()" [disabled]="locating()">{{locating() ? 'Buscando…' : '◎ Mi ubicación'}}</button>
      </div>
      <div class="place-search">
        <input type="search" autocomplete="off" aria-label="Buscar localidad o distrito" placeholder="Ej. Perené, Satipo, Huancayo…" [value]="query()" (input)="query.set($any($event.target).value)" (keydown.enter)="search($event)" />
        <button type="button" (click)="search($event)" class="button" [disabled]="searching() || query().trim().length < 2">{{searching() ? 'Buscando…' : 'Buscar lugar'}}</button>
      </div>
      @if(results().length){
        <div class="place-results" role="group" aria-label="Lugares encontrados">
          @for(place of results();track place.label+place.latitude){
            <button type="button" (click)="choose(place)"><span class="place-pin">⌖</span><span>{{place.label}}</span><span aria-hidden="true">↗</span></button>
          }
        </div>
      }
      @if(noResults()){<p class="info small">No encontramos esa localidad. Prueba con el distrito o provincia, o marca la parcela en el mapa.</p>}
      @if(error()){<p class="error" role="alert">{{error()}}</p>}
      <div class="farm-map-wrap">
        <div #mapHost class="farm-map" role="application" aria-label="Mapa para seleccionar la ubicación de una parcela"></div>
        @if(mapLoading()){<div class="map-unavailable" role="status">Preparando el mapa…</div>}
        @if(mapUnavailable()){<div class="map-unavailable" role="status">No se pudo abrir el mapa. Puedes buscar una localidad o utilizar el GPS; revisa tu conexión a internet para seleccionar el punto exacto.</div>}
        <span class="map-tip">Toca el mapa o arrastra el marcador para ajustar la ubicación</span>
      </div>
      @if(chosen()){
        <div class="chosen-place"><span aria-hidden="true">✓</span><div><strong>Ubicación seleccionada</strong><p>{{chosen()!.location}}</p></div><button type="button" class="text-link" (click)="clear()">Cambiar</button></div>
        <label class="place-reference">Referencia para reconocer tu parcela (opcional)
          <input type="text" maxlength="160" [value]="label()" (input)="updateLabel($any($event.target).value)" placeholder="Ej. Sector San Ramón, junto al río" />
          <small>El pronóstico utilizará el punto marcado, no el texto de esta referencia.</small>
        </label>
      }@else{<p class="location-pending">Selecciona un lugar para guardar la parcela y consultar su pronóstico.</p>}
      <p class="map-credit">Mapa © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> · Búsqueda de localidades por <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">Open-Meteo / GeoNames</a>. El GPS requiere tu permiso.</p>
    </section>
  `,
})
export class LocationPicker implements AfterViewInit, OnDestroy {
  private api = inject(Api);
  @ViewChild('mapHost') mapHost?: ElementRef<HTMLDivElement>;
  initialLatitude = input<number | null>(null);
  initialLongitude = input<number | null>(null);
  initialLocation = input('');
  picked = output<FarmLocation | null>();

  query = signal(''); label = signal('');
  chosen = signal<FarmLocation | null>(null);
  results = signal<PlaceResult[]>([]);
  error = signal(''); searching = signal(false); locating = signal(false);
  noResults = signal(false); mapUnavailable = signal(false); mapLoading = signal(true);
  private map: any; private marker: any;
  private closed = false;

  ngAfterViewInit() {
    const lat = this.initialLatitude(), lng = this.initialLongitude();
    if (lat !== null && lng !== null && Number.isFinite(lat) && Number.isFinite(lng)) {
      const location = this.initialLocation() || 'Mi parcela';
      this.label.set(location);
      this.chosen.set({latitude: lat, longitude: lng, location});
    }
    void this.setupMap();
  }

  private async setupMap() {
    try {
      await loadLeaflet();
      if (this.closed || !this.mapHost) return;
      this.map = L.map(this.mapHost.nativeElement, {scrollWheelZoom: false, zoomControl: true})
        .setView(this.chosen() ? [this.chosen()!.latitude, this.chosen()!.longitude] : [-10.6, -75.0], this.chosen() ? 14 : 6);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(this.map);
      this.map.on('click', (event: any) => {
        this.setPoint(event.latlng.lat, event.latlng.lng, this.label() || 'Ubicación marcada en el mapa', false);
      });
      if (this.chosen()) this.moveMarker(this.chosen()!.latitude, this.chosen()!.longitude, false);
      setTimeout(() => { if (!this.closed) this.map?.invalidateSize(); }, 100);
    } catch {
      if (!this.closed) this.mapUnavailable.set(true);
    } finally {
      if (!this.closed) this.mapLoading.set(false);
    }
  }

  private moveMarker(lat: number, lng: number, center: boolean) {
    if (!this.map) return;
    if (!this.marker) {
      this.marker = L.marker([lat, lng], {draggable: true}).addTo(this.map);
      this.marker.on('dragend', () => {
        const point = this.marker.getLatLng();
        this.setPoint(point.lat, point.lng, this.label() || 'Ubicación marcada en el mapa', false);
      });
    } else {
      this.marker.setLatLng([lat, lng]);
    }
    if (center) this.map.setView([lat, lng], 15);
  }

  private setPoint(lat: number, lng: number, name: string, center = true) {
    const location = name.trim().slice(0, 160) || 'Ubicación marcada en el mapa';
    const next = {latitude: Number(lat.toFixed(6)), longitude: Number(lng.toFixed(6)), location};
    this.chosen.set(next);
    this.label.set(location);
    this.error.set('');
    this.results.set([]);
    this.noResults.set(false);
    this.moveMarker(next.latitude, next.longitude, center);
    this.picked.emit(next);
  }

  async search(event: Event) {
    event.preventDefault();
    const name = this.query().trim();
    if (name.length < 2 || this.searching()) return;
    this.searching.set(true); this.error.set(''); this.noResults.set(false); this.results.set([]);
    try {
      const places = await this.api.get<PlaceResult[]>('locations/search?name=' + encodeURIComponent(name));
      if (this.closed) return;
      this.results.set(places);
      this.noResults.set(!places.length);
    } catch (e) { if (!this.closed) this.error.set(errorMessage(e)); }
    finally { if (!this.closed) this.searching.set(false); }
  }

  choose(place: PlaceResult) {
    this.query.set(place.label);
    this.setPoint(place.latitude, place.longitude, place.label);
  }

  useGps() {
    if (!navigator.geolocation) {
      this.error.set('Este dispositivo no permite obtener la ubicación. Prueba con el buscador o el mapa.');
      return;
    }
    this.locating.set(true); this.error.set('');
    navigator.geolocation.getCurrentPosition(
      position => {
        if (this.closed) return;
        this.locating.set(false);
        this.setPoint(position.coords.latitude, position.coords.longitude, 'Ubicación obtenida por GPS');
      },
      error => {
        if (this.closed) return;
        this.locating.set(false);
        this.error.set(error.code === 1 ? 'No diste permiso para usar tu ubicación. Puedes buscar tu localidad o tocar el mapa.' : 'No se pudo obtener el GPS. Puedes buscar tu localidad o tocar el mapa.');
      },
      {enableHighAccuracy: true, timeout: 12000, maximumAge: 60000},
    );
  }

  updateLabel(text: string) {
    const label = text.slice(0, 160);
    this.label.set(label);
    const picked = this.chosen();
    if (picked) {
      const next = {...picked, location: label.trim() || 'Ubicación marcada en el mapa'};
      this.chosen.set(next);
      this.picked.emit(next);
    }
  }

  clear() {
    this.chosen.set(null);
    this.picked.emit(null);
    if (this.marker && this.map) { this.map.removeLayer(this.marker); this.marker = null; }
  }

  ngOnDestroy() {
    this.closed = true;
    this.map?.remove();
  }
}
