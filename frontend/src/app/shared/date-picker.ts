import { Component, computed, input, output, signal } from '@angular/core';

@Component({
  selector: 'agro-date-picker',
  template: `
    <div class="agro-date-picker" (keydown.escape)="open.set(false)">
      <button class="agro-date-trigger" type="button" [attr.aria-label]="label()" [attr.aria-expanded]="open()" aria-haspopup="dialog" (click)="toggle($event)">
        <span class="agro-date-trigger-icon">▦</span><span>{{ formatted() }}</span><span class="agro-date-chevron">⌄</span>
      </button>
      @if(open()){
        <div class="agro-date-popover" role="dialog" [attr.aria-label]="'Seleccionar ' + label()" (click)="$event.stopPropagation()">
          <div class="agro-date-head">
            <button type="button" aria-label="Mes anterior" (click)="shift(-1)">‹</button>
            <strong>{{ monthLabel() }}</strong>
            <button type="button" aria-label="Mes siguiente" (click)="shift(1)">›</button>
          </div>
          <div class="agro-date-weekdays">@for(d of weekdays;track d){<span>{{d}}</span>}</div>
          <div class="agro-date-days">
            @for(d of days();track d.iso){
              <button type="button" [class.outside]="!d.current" [class.selected]="d.iso===value()" [class.today]="d.iso===today" [disabled]="!!max() && d.iso > max()" [attr.aria-label]="d.iso" [attr.aria-pressed]="d.iso===value()" (click)="choose(d.iso)">{{d.day}}</button>
            }
          </div>
          <div class="agro-date-actions"><button type="button" [disabled]="!!max() && today > max()" (click)="choose(today)">Hoy</button><button type="button" (click)="choose('')">Borrar</button></div>
        </div>
      }
    </div>
  `
})
export class AgroDatePicker {
  value = input<string>(''); label = input<string>('Fecha'); max = input<string>(''); valueChange = output<string>();
  open = signal(false);
  today = localISO(new Date());
  month = signal((this.today).slice(0,7));
  weekdays = ['Lu','Ma','Mi','Ju','Vi','Sa','Do'];
  formatted = computed(() => this.value() ? new Intl.DateTimeFormat('es-PE',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(this.value()+'T12:00:00Z')) : 'Seleccionar fecha');
  monthLabel = computed(() => new Intl.DateTimeFormat('es-PE',{month:'long',year:'numeric'}).format(new Date(this.month()+'-01T12:00:00Z')));
  days = computed(() => {
    const [y,m] = this.month().split('-').map(Number);
    const start = new Date(Date.UTC(y,m-1,1,12));
    const offset = (start.getUTCDay()+6)%7;
    return Array.from({length:42},(_,i)=>{
      const date = new Date(Date.UTC(y,m-1,1-offset+i,12));
      return {iso:date.toISOString().slice(0,10),day:date.getUTCDate(),current:date.getUTCMonth()===m-1};
    });
  });
  toggle(event:Event){event.stopPropagation();if(!this.open()){this.month.set((this.value()||this.today).slice(0,7));}this.open.update(v=>!v);}
  shift(n:number){const [y,m]=this.month().split('-').map(Number);const d=new Date(Date.UTC(y,m-1+n,1));this.month.set(d.toISOString().slice(0,7));}
  choose(v:string){if(v && this.max() && v>this.max())return;this.valueChange.emit(v);this.open.set(false);}
}
function localISO(date:Date){return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Lima',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);}
