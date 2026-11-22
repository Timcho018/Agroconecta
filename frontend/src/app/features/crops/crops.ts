import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { Api, errorMessage } from '../../core/api';
import { Entity } from '../../core/models';
import { Icon } from '../../shared/icon';

interface CatalogCrop {
  id: number;
  name: string;
  scientific_name: string;
  image_url: string;
  image_credit: string;
  image_license: string;
  source: string;
}

interface CropPhoto {
  url: string;
  credit: string;
  license: string;
  observation_url: string;
}

function normalized(text: string) {
  return text.toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

@Component({
  selector: 'agro-crops', imports: [Icon], styleUrl: './crops.scss', template: `
    <div class="crop-page-intro">
      <div>
        <span class="crop-kicker">TU CATÁLOGO AGRÍCOLA</span>
        <h1>Cultivos<span>.</span></h1>
        <p>Organiza las especies y variedades que trabajas en tu campo.</p>
      </div>
      <button class="button crop-new" (click)="edit()"><agro-icon name="plus"/> Registrar cultivo</button>
    </div>
    <div class="crop-toolbar">
      <div class="crop-views" role="tablist" aria-label="Estado de los cultivos">
        <button type="button" role="tab" [class.active]="view() === 'active'" [attr.aria-selected]="view() === 'active'" (click)="view.set('active')">Activos <span>{{activeCount()}}</span></button>
        <button type="button" role="tab" [class.active]="view() === 'inactive'" [attr.aria-selected]="view() === 'inactive'" (click)="view.set('inactive')">Desactivados <span>{{inactiveCount()}}</span></button>
      </div>
      <div class="crop-search-wrap"><span aria-hidden="true">⌕</span><input aria-label="Buscar entre mis cultivos" placeholder="Buscar en mis cultivos…" [value]="filter()" (input)="filter.set($any($event.target).value)" /></div>
      <span class="crop-count">{{ filtered().length }} {{ filtered().length === 1 ? 'cultivo' : 'cultivos' }} · Más recientes primero</span>
    </div>
    @if(error()){<p class="error" role="alert">{{error()}}</p><button class="button ghost" (click)="load()">Reintentar</button>}
    @if(loading()){<p class="loading">Cargando cultivos…</p>}
    <div class="crop-gallery">
      @for(c of filtered();track c.id){
        <article class="crop-tile">
          <div class="crop-photo">
            @if(coverFor(c); as cover){
              <button type="button" class="crop-photo-view" (click)="inspectPhoto(c)" [attr.aria-label]="'Ver fotografía completa de ' + c.name" title="Ver fotografía completa">
                <img class="crop-photo-main" [src]="cover" alt="Fotografía del cultivo {{c.name}}" loading="lazy" (error)="$any($event.target).style.opacity='0'" />
                <span class="crop-photo-expand" aria-hidden="true">↗ &nbsp;Ver foto completa</span>
              </button>
            }
            <span class="crop-status" [class.is-inactive]="c.active === false"><span class="dot"></span>{{ c.active === false ? 'Inactivo' : 'Activo' }}</span>
            @if(c.image_source === 'inaturalist' && c.image_credit){
              <button type="button" class="crop-attribution-toggle" [attr.aria-expanded]="creditOpen() === c.id" [attr.aria-label]="'Ver origen y licencia de la fotografía de ' + c.name" (click)="creditOpen.set(creditOpen()===c.id ? null:c.id)">ⓘ</button>
              @if(creditOpen() === c.id){
                <div class="crop-attribution-popover"><strong>Fotografía de iNaturalist</strong><span>{{c.image_credit}} · {{c.image_license}}</span>
                  <a [href]="'https://www.inaturalist.org/taxa/' + c.image_taxon_id" target="_blank" rel="noopener noreferrer">Ver fuente y licencia ↗</a>
                </div>
              }
            }
          </div>

          <div class="crop-tile-body">
            <h2>{{ c.name }}</h2>
            @if(c.variety?.trim()){<span class="crop-variety">({{ c.variety }})</span>}
            <p class="crop-notes">{{ c.notes || 'Sin observaciones adicionales.' }}</p>
            <div class="crop-metadata"><span>Ciclo de referencia</span><strong>{{ c.cycle_days ? c.cycle_days + ' días' : 'No definido' }}</strong></div>
            <div class="crop-tile-actions"><button type="button" (click)="edit(c)">Editar <span>↗</span></button><button type="button" [disabled]="busy()" (click)="requestStatus(c)">{{c.active === false ? 'Reactivar' : 'Desactivar'}}</button></div>
          </div>
        </article>
      }
    </div>
    @if(!loading() && !error() && !filtered().length){
      <section class="crop-empty"><span class="crop-empty-illustration">✳</span>
        <h2>{{ filter().trim() ? 'No encontramos coincidencias.' : view() === 'inactive' ? 'No tienes cultivos desactivados.' : 'Tu próximo cultivo comienza aquí.' }}</h2>
        <p>{{ filter().trim() ? 'Prueba con otro nombre o cambia de pestaña.' : view() === 'inactive' ? 'Cuando desactives un cultivo, podrás consultarlo y reactivarlo aquí. No se elimina su información.' : 'Registra tu primer cultivo. AgroConecta puede buscar sus fotografías automáticamente.' }}</p>
        @if(view() === 'active' && !filter().trim()){<button class="button" (click)="edit()">Añadir cultivo</button>}
      </section>
    }
    @if(pendingStatus(); as target){
      <div class="crop-confirm-backdrop">
        <section class="crop-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="crop-confirm-title" aria-describedby="crop-confirm-text">
          <span class="crop-confirm-mark" aria-hidden="true">!</span>
          <h2 id="crop-confirm-title">¿Desactivar {{target.name}}?</h2>
          <p id="crop-confirm-text">Este cultivo dejará de aparecer en <strong>Activos</strong>, pero conservarás todos sus datos. Podrás recuperarlo desde <strong>Desactivados</strong> cuando quieras.</p>
          @if(statusError()){<p class="error" role="alert">{{statusError()}}</p>}
          <div class="crop-confirm-actions">
            <button type="button" class="crop-cancel" [disabled]="busy()" (click)="pendingStatus.set(null)">Conservar activo</button>
            <button type="button" class="button crop-confirm-primary" [disabled]="busy()" (click)="toggle(target)">{{busy() ? 'Desactivando…' : 'Sí, desactivar'}}</button>
          </div>
        </section>
      </div>
    }
    @if(photoModal(); as photo){
      <div class="crop-lightbox-backdrop" (click)="photoModal.set(null)">
        <section class="crop-lightbox" role="dialog" aria-modal="true" aria-labelledby="crop-lightbox-title" (click)="$event.stopPropagation()">
          <header><div><span class="crop-kicker">FOTOGRAFÍA DEL CULTIVO</span><h2 id="crop-lightbox-title">{{photo.name}}</h2></div><button type="button" class="crop-x" aria-label="Cerrar fotografía" (click)="photoModal.set(null)">×</button></header>
          <div class="crop-lightbox-media"><img [src]="photo.url" [alt]="'Fotografía completa de ' + photo.name"/></div>
          @if(photo.credit){<p class="crop-lightbox-credit">Fuente: iNaturalist · {{photo.credit}} @if(photo.license){· {{photo.license}}}</p>}
        </section>
      </div>
    }
    @if(editor()){
      <div class="modal-backdrop crop-backdrop">
        <section class="crop-editor-modal" role="dialog" aria-modal="true" aria-labelledby="crop-editor-title" (click)="$event.stopPropagation()">
          <header class="crop-editor-head"><div><span class="crop-kicker">TU CUADERNO DE CAMPO</span><h2 id="crop-editor-title">{{ selected() ? 'Editar cultivo' : 'Registrar cultivo' }}</h2><p>Encuentra la especie, completa su ficha y guarda los cambios.</p></div>
            <button class="crop-x" type="button" aria-label="Cerrar" [disabled]="busy()" (click)="dismiss()">×</button></header>
          <div class="crop-editor-content">
            <div class="crop-editor-fields">
              <div class="crop-form-field crop-name-field">
                <label for="crop-name">Nombre del cultivo <span>*</span></label>
                <div class="crop-search-input"><span aria-hidden="true">⌕</span><input id="crop-name" type="text" autocomplete="off" maxlength="100" placeholder="Ej. papa, quinua, cacao…" [value]="name()" (input)="onName($any($event.target).value)" (focus)="suggestionsOpen.set(true)" aria-autocomplete="list" [attr.aria-expanded]="suggestionsOpen()" aria-controls="crop-matches" /></div>
                @if(suggestionsOpen() && name().trim().length >= 2){
                  <div class="crop-suggestions" id="crop-matches" role="listbox">
                    <div class="crop-results-head"><span>ESPECIES EN INATURALIST</span>@if(searching()){<span>Buscando…</span>}</div>
                    @for(item of results();track item.id){
                      <button type="button" role="option" [attr.aria-selected]="chosen()?.id === item.id" (click)="choose(item)">
                        @if(item.image_url){<img [src]="item.image_url" alt="" loading="lazy"/>}@else{<span class="crop-mini-placeholder">✳</span>}
                        <span class="crop-result-info"><strong>{{item.name}}</strong><small>{{item.scientific_name}}</small></span><span class="crop-select-arrow">↗</span>
                      </button>
                    }
                    @if(!searching() && !results().length){<p class="crop-empty-results">{{ searchError() || 'No hay coincidencias. Puedes continuar escribiendo el nombre y añadir tu foto.' }}</p>}
                    <button type="button" class="crop-free-entry" (click)="suggestionsOpen.set(false)">Continuar con «{{name()}}» sin seleccionar especie <span>→</span></button>
                  </div>
                }
                <small>Busca por nombre común o científico. También puedes escribir uno que no esté en iNaturalist.</small>
              </div>
              <div class="crop-form-field crop-variety-field">
                <label for="crop-variety">Variedad <span class="crop-optional">Opcional</span></label>
                <input id="crop-variety" maxlength="100" autocomplete="off" placeholder="Ej. Canchán, Cacao negro, CCN-51…" [value]="variety()" (input)="variety.set($any($event.target).value)" />
                <small>Escribe la variedad que cultivas. Aparecerá debajo del nombre en tu catálogo.</small>
              </div>
              <div class="crop-form-field crop-cycle-row"><label for="crop-cycle">Ciclo estimado del cultivo</label><div class="crop-number-field"><input id="crop-cycle" type="number" min="0" max="3650" step="1" placeholder="Opcional" [value]="cycle()" (input)="cycle.set($any($event.target).value)"/><span>días</span></div><small>Duración orientativa desde la siembra hasta la cosecha. Por ahora es informativa; no genera alertas automáticas.</small></div>
              <div class="crop-form-field"><label for="crop-notes">Características y observaciones</label><textarea id="crop-notes" rows="4" maxlength="2000" placeholder="Notas sobre el cultivo, manejo y características…" [value]="notes()" (input)="notes.set($any($event.target).value)"></textarea></div>
            </div>
            <aside class="crop-photo-column">
              <div class="crop-photo-frame" [class.has-image]="!!previewUrl()">
                @if(previewUrl() && !imageError()){
                  <img [src]="previewUrl()" alt="Vista previa completa del cultivo {{name()}}" (error)="imageError.set(true)"/>
                  <span class="crop-preview-caption">{{ uploadedFile() ? 'FOTO PROPIA' : 'REFERENCIA DE LA ESPECIE' }}</span>
                }@else{
                  <div class="crop-photo-empty"><span class="crop-photo-symbol">✳</span><strong>Tu cultivo, en imagen.</strong><p>Selecciona una especie para ver su fotografía aquí.</p></div>
                }
              </div>
              <div class="crop-photo-aside-foot">
                @if(name().trim()){
                  <div class="crop-live-identity"><strong>{{name()}}</strong>@if(variety().trim()){<span>({{variety()}})</span>}</div>
                }
                @if(uploadedFile()){
                  <span class="crop-photo-source">Fotografía propia · Tu dispositivo</span>
                }@else if(photoChoice()){
                  <span class="crop-photo-source">Fotografía de una observación en iNaturalist</span>
                  <p class="crop-credit">{{photoChoice()!.credit}} · {{photoChoice()!.license}} · <a [href]="photoChoice()!.observation_url" target="_blank" rel="noopener noreferrer">Ver origen ↗</a></p>
                }@else if(chosen() && chosen()!.image_url && previewUrl()){
                  <span class="crop-photo-source">Foto de referencia de la especie (iNaturalist)</span>
                  <p class="crop-credit">{{chosen()!.image_credit}} · {{chosen()!.image_license}}</p>
                }@else if(selected()?.image_source === 'inaturalist' && previewUrl()){
                  <span class="crop-photo-source">Fotografía de especie · iNaturalist</span>
                  <p class="crop-credit">{{selected()?.image_credit}} · {{selected()?.image_license}}</p>
                }@else{<span class="crop-photo-source">La imagen es opcional</span>}
                @if(photoTaxonId()){
                  <button type="button" class="crop-photos-button" [disabled]="photosLoading()" (click)="loadPhotos()">
                    <span aria-hidden="true">▧</span> {{photosLoading() ? 'Buscando fotos reales…' : photosOpened() ? 'Actualizar fotos de la especie' : 'Ver otras fotos reales'}}
                  </button>
                  @if(photosOpened()){
                    @if(photoChoices().length){
                      <div class="crop-photo-options" aria-label="Fotografías reales de esta especie">
                        @for(photo of photoChoices();track photo.url){
                          <button type="button" [class.active]="previewUrl() === photo.url" [title]="photo.credit + ' · ' + photo.license" [attr.aria-label]="'Elegir foto de iNaturalist: ' + photo.credit" (click)="choosePhoto(photo)">
                            <img [src]="photo.url" alt="Fotografía alternativa de la especie" loading="lazy"/>
                          </button>
                        }
                      </div>
                    }@else if(!photosLoading()){
                      <p class="crop-photo-feedback">{{photoError() || 'No se encontraron fotos con licencia aceptada. Puedes subir tu propia imagen.'}}</p>
                    }
                    <small>Fotografías reales de observaciones. No garantizan mostrar el fruto ni una variedad específica.</small>
                  }
                }
                <label class="crop-upload-control" for="crop-file"><span>↑</span> {{ previewUrl() ? 'Cambiar por mi foto' : 'Subir foto desde mi dispositivo' }}</label>
                <input #fileInput id="crop-file" type="file" accept="image/jpeg,image/png,image/webp" (change)="uploadFromDevice($event)" />
                <small>JPG, PNG o WebP · Máximo 4 MB. La foto se guardará en tu cuenta.</small>
              </div>
            </aside>
          </div>
          @if(formError()){<p class="error crop-modal-error" role="alert">{{ formError() }}</p>}
          <footer class="crop-editor-foot"><button type="button" class="crop-cancel" [disabled]="busy()" (click)="dismiss()">Cancelar</button><button type="button" class="button crop-submit" [disabled]="busy()" (click)="save()">{{busy()?'Guardando…': selected() ? 'Guardar cambios' : 'Registrar cultivo'}} <span>↗</span></button></footer>
        </section>
      </div>
    }
  `
})
export class Crops implements OnInit, OnDestroy {
  api = inject(Api);
  crops = signal<Entity[]>(this.api.peek<Entity[]>('crops') ?? []);
  error = signal(''); loading = signal(!this.api.peek<Entity[]>('crops'));
  editor = signal(false); selected = signal<Entity|null>(null); busy = signal(false); formError = signal('');
  filter = signal(''); view = signal<'active'|'inactive'>('active');
  creditOpen = signal<string|null>(null);
  photoModal = signal<{url:string;name:string;credit:string;license:string}|null>(null);
  pendingStatus = signal<Entity|null>(null); statusError = signal('');
  activeCount = computed(() => this.crops().filter(c => c.active !== false).length);
  inactiveCount = computed(() => this.crops().filter(c => c.active === false).length);
  name = signal(''); variety = signal(''); cycle = signal(''); notes = signal('');
  results = signal<CatalogCrop[]>([]); chosen = signal<CatalogCrop|null>(null);
  searchError = signal(''); searching = signal(false); suggestionsOpen = signal(false);
  previewUrl = signal(''); imageError = signal(false); uploadedFile = signal<File|null>(null);
  photoChoices = signal<CropPhoto[]>([]); photoChoice = signal<CropPhoto|null>(null);
  photosOpened = signal(false); photosLoading = signal(false); photoError = signal('');
  private photosCache = new Map<number,CropPhoto[]>();
  private photoSeq = 0;
  private searchTimer?: ReturnType<typeof setTimeout>;
  private lookupSeq = 0;
  private objectUrl = '';
  private queryCache = new Map<string, CatalogCrop[]>();

  ngOnInit(){ void this.load(); }
  ngOnDestroy(){ clearTimeout(this.searchTimer); if(this.objectUrl) URL.revokeObjectURL(this.objectUrl); }
  photoTaxonId(): number|null {
    if(this.chosen()) return this.chosen()!.id;
    const prior=this.selected();
    return prior && normalized(prior.name) === normalized(this.name()) ? (prior.image_taxon_id || null) : null;
  }
  resetPhotos(){this.photoSeq++;this.photoChoices.set([]);this.photoChoice.set(null);this.photosOpened.set(false);this.photosLoading.set(false);this.photoError.set('');}
  async loadPhotos(){
    const id=this.photoTaxonId();if(!id)return;
    const seq=++this.photoSeq;
    this.photosOpened.set(true);this.photosLoading.set(true);this.photoError.set('');
    const cached=this.photosCache.get(id);
    if(cached){this.photoChoices.set(cached);this.photosLoading.set(false);return;}
    try{
      const data=await this.api.get<CropPhoto[]>('catalog/photos?taxon_id='+encodeURIComponent(id));
      this.photosCache.set(id,data);
      if(this.photoSeq===seq)this.photoChoices.set(data);
    }catch(e){if(this.photoSeq===seq){this.photoChoices.set([]);this.photoError.set(errorMessage(e));}}
    finally{if(this.photoSeq===seq)this.photosLoading.set(false);}
  }
  choosePhoto(photo:CropPhoto){
    this.photoChoice.set(photo);this.uploadedFile.set(null);
    if(this.objectUrl){URL.revokeObjectURL(this.objectUrl);this.objectUrl='';}
    this.imageError.set(false);this.previewUrl.set(photo.url);
  }
  filtered = computed(() => {
    const query = normalized(this.filter());
    const isInactive = this.view() === 'inactive';
    return this.crops()
      .filter(c => (c.active === false) === isInactive && normalized(c.name + ' ' + (c.variety || '')).includes(query))
      .sort((a, b) => (b.created_at || b.updated_at || '').localeCompare(a.created_at || a.updated_at || '') || b.id.localeCompare(a.id));
  });
  inspectPhoto(c:Entity){ const url=this.coverFor(c); if(url)this.photoModal.set({url,name:c.name,credit:c.image_source==='inaturalist' ? (c.image_credit||'') : '',license:c.image_license||''}); }
  coverFor(c:Entity):string {
    if(c.image_source==='custom' && c.crop_photo_version)return `/api/crops/${encodeURIComponent(c.id)}/photo?v=${encodeURIComponent(c.crop_photo_version)}`;
    if(c.image_source==='inaturalist' && c.image_url)return c.image_url;
    return '';
  }
  async load(){this.loading.set(!this.api.peek<Entity[]>('crops'));this.error.set('');try{this.crops.set(await this.api.list('crops'));}catch(e){this.error.set(errorMessage(e));}finally{this.loading.set(false);}}
  edit(c?:Entity){
    clearTimeout(this.searchTimer);this.lookupSeq++;
    this.selected.set(c||null); this.name.set(c?.name||''); this.variety.set(c?.variety||'');
    this.cycle.set(c?.cycle_days?String(c.cycle_days):''); this.notes.set(c?.notes||'');
    this.chosen.set(null);this.uploadedFile.set(null);this.results.set([]);this.searchError.set('');this.searching.set(false);
    this.formError.set('');this.imageError.set(false);this.suggestionsOpen.set(false);
    this.resetPhotos();
    if(this.objectUrl){URL.revokeObjectURL(this.objectUrl);this.objectUrl='';}
    this.previewUrl.set(c?this.coverFor(c):''); // NUEVO: empieza siempre vacío.
    this.editor.set(true);
  }
  onName(value:string){
    const previousName=this.name();
    const hadSelectedSpecies=!!this.chosen();
    if(normalized(value)!==normalized(previousName))this.variety.set('');
    // La foto de una especie anterior no debe quedar asociada a un nombre nuevo.
    if(!this.uploadedFile() && (hadSelectedSpecies || this.selected()?.image_source === 'inaturalist')
       && normalized(value) !== normalized(this.selected()?.name || '')){
      this.previewUrl.set('');this.imageError.set(false);
    }
    this.name.set(value);this.chosen.set(null);this.formError.set('');this.suggestionsOpen.set(true);this.results.set([]);
    this.resetPhotos();
    clearTimeout(this.searchTimer);const seq=++this.lookupSeq;
    if(value.trim().length<2){this.searching.set(false);this.searchError.set('');return;}
    // Los resultados anteriores siguen visibles hasta que la nueva consulta termine.
    // Un cambio de texto invalida siempre la respuesta anterior (evita carreras).
    const query = normalized(value);
    const cached = this.queryCache.get(query);
    if (cached) { this.results.set(cached); this.searching.set(false); this.searchError.set(''); return; }
    this.searching.set(true); this.searchError.set('');
    this.searchTimer=setTimeout(async()=>{
      try{
        const data=await this.api.get<CatalogCrop[]>('catalog/crops?q='+encodeURIComponent(value.trim()));
        this.queryCache.set(query,data);
        if(this.queryCache.size>120)this.queryCache.delete(this.queryCache.keys().next().value!);
        if(this.lookupSeq===seq){this.results.set(data);this.searchError.set('');}
      } catch(e) { if(this.lookupSeq===seq){this.results.set([]);this.searchError.set(errorMessage(e));} }
      finally { if(this.lookupSeq===seq)this.searching.set(false); }
    },240);
  }
  choose(c:CatalogCrop){
    this.lookupSeq++;clearTimeout(this.searchTimer);
    this.name.set(c.name);this.chosen.set(c);this.suggestionsOpen.set(false);
    this.variety.set('');this.resetPhotos();
    this.results.set([]);this.searching.set(false);this.imageError.set(false);
    this.uploadedFile.set(null);
    if(this.objectUrl){URL.revokeObjectURL(this.objectUrl);this.objectUrl='';}
    this.previewUrl.set(c.image_url || '');
  }
  uploadFromDevice(event:Event){
    const input=event.target as HTMLInputElement;const file=input.files?.[0];
    if(!file)return;
    if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>4*1024*1024){
      this.formError.set('Usa una fotografía JPG, PNG o WebP de máximo 4 MB.');input.value='';return;
    }
    this.formError.set('');this.imageError.set(false);this.uploadedFile.set(file);this.photoChoice.set(null);
    if(this.objectUrl)URL.revokeObjectURL(this.objectUrl);
    this.objectUrl=URL.createObjectURL(file);this.previewUrl.set(this.objectUrl);
    input.value='';
  }
  async save(){
    if(this.busy())return;
    const label=this.name().trim(),n=this.cycle().trim()?Number(this.cycle()):0;
    if(label.length<2){this.formError.set('Escribe el nombre del cultivo (mínimo 2 caracteres).');return;}
    if(!Number.isInteger(n)||n<0||n>3650){this.formError.set('El ciclo debe ser un número entero entre 0 y 3650.');return;}
    const picked=this.chosen();const prior=this.selected();
    let image_source='';let image_url='';let image_credit='';let image_license='';let image_taxon_id:number|null=null;
    if(this.photoChoice()){const photo=this.photoChoice()!;image_source='inaturalist';image_url=photo.url;image_credit=photo.credit;image_license=photo.license;image_taxon_id=this.photoTaxonId();}
    else if(picked){image_source=picked.image_url?'inaturalist':'';image_url=picked.image_url;image_credit=picked.image_credit;image_license=picked.image_license;image_taxon_id=picked.id;}
    else if(prior && (prior.image_source === 'custom' || normalized(label) === normalized(prior.name))){
      image_source=prior.image_source||'';image_url=prior.image_url||'';image_credit=prior.image_credit||'';image_license=prior.image_license||'';image_taxon_id=prior.image_taxon_id||null;
    }
    this.busy.set(true);this.formError.set('');
    try{
      const saved=await this.api.save('crops',{name:label,variety:this.variety().trim(),cycle_days:n,
        notes:this.notes().trim(),active:prior?.active!==false,image_source,image_url,image_credit,image_license,image_taxon_id},prior?.id);
      if(this.uploadedFile()){
        try{await this.api.cropPhoto(saved.id,this.uploadedFile()!);}
        catch(e){this.selected.set(saved);await this.load();this.formError.set('Se guardó el cultivo, pero no la fotografía. '+errorMessage(e));return;}
      }
      // Nunca pasar por dismiss() mientras busy=true: antes bloqueaba el cierre tras guardar.
      this.closeEditor();
      await this.load();
    }catch(e){this.formError.set(errorMessage(e));}
    finally{this.busy.set(false);}
  }
  requestStatus(c:Entity){
    if(this.busy()) return;
    if(c.active === false){void this.toggle(c);return;}
    this.statusError.set('');this.pendingStatus.set(c);
  }
  async toggle(c:Entity){
    if(this.busy())return;
    this.busy.set(true);this.error.set('');this.statusError.set('');
    try{
      await this.api.save('crops',{name:c.name,variety:c.variety,cycle_days:c.cycle_days,notes:c.notes,
        active:c.active===false,image_source:c.image_source||'',image_url:c.image_url||'',
        image_credit:c.image_credit||'',image_license:c.image_license||'',image_taxon_id:c.image_taxon_id||null},c.id);
      this.pendingStatus.set(null);
      await this.load();
    }catch(e){const message=errorMessage(e);if(this.pendingStatus())this.statusError.set(message);else this.error.set(message);}
    finally{this.busy.set(false);}
  }
  private closeEditor(){this.editor.set(false);this.suggestionsOpen.set(false);this.lookupSeq++;clearTimeout(this.searchTimer);
    if(this.objectUrl){URL.revokeObjectURL(this.objectUrl);this.objectUrl='';}}
  dismiss(){if(this.busy())return;this.closeEditor();}
}
