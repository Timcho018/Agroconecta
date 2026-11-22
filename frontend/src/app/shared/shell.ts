import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet, NavigationStart, NavigationEnd, NavigationCancel, NavigationError } from '@angular/router';
import { Auth, errorMessage } from '../core/api';
import { Icon } from './icon';

@Component({ selector: 'agro-shell', imports: [RouterOutlet, RouterLink, RouterLinkActive, Icon], template: `
  <div class="workspace">
    @if(open()){<button class="nav-backdrop" aria-label="Cerrar navegación" (click)="open.set(false)"></button>}
    <aside class="sidebar" [class.open]="open()"><a class="brand" routerLink="/inicio"><img class="brand-emblem" src="agroconecta.svg" alt="" />Agroconecta</a><p class="sidebar-kicker">CUADERNO DE CAMPO</p>
      <nav aria-label="Navegación principal">@for(item of navigation; track item.path){<a [routerLink]="item.path" routerLinkActive="active" ariaCurrentWhenActive="page" (click)="open.set(false)"><agro-icon [name]="item.icon" />{{ item.label }}<span class="nav-mark">↗</span></a>}</nav>
      <div class="sidebar-bottom"><div class="account-panel">
        <span class="account-overline"><span class="account-status-dot"></span> MI CUENTA</span>
        <div class="account-identity"><span class="account-avatar">{{initials()}}</span><div class="account-meta"><strong>{{auth.user()?.name || 'Agricultor'}}</strong><small>Mi espacio agrícola</small></div></div>
        <button type="button" class="account-signout" (click)="logout()"><agro-icon name="exit"/><span>Cerrar sesión</span><span aria-hidden="true">↗</span></button>
      </div></div>
    </aside>
    <div class="main-workspace"><header class="topbar"><button class="icon-button mobile-toggle" aria-label="Abrir navegación" [attr.aria-expanded]="open()" (click)="open.set(!open())">☰</button><span class="breadcrumb">Cuaderno de campo <span>/</span> <strong>{{ currentSection() }}</strong></span><span class="top-date">{{ today }}</span><a class="icon-button" routerLink="/alertas" aria-label="Ver alertas"><agro-icon name="bell" /></a></header>
      @if(navigating()){<div class="workspace-route-progress" role="status" aria-label="Abriendo sección"><span></span></div>}
      <main class="page-content" id="main-content" tabindex="-1">@if(error()){<p class="error" role="alert">{{ error() }}</p>}<router-outlet /></main><footer class="page-footer">Agroconecta <span>Planifica. Registra. Crece.</span><span>Hecho para quien trabaja la tierra</span></footer>
    </div>
  </div>`,
})
export class Shell {
  auth = inject(Auth); router = inject(Router); open = signal(false); error = signal(''); navigating = signal(false);
  today = new Intl.DateTimeFormat('es-PE', { dateStyle: 'long', timeZone: 'America/Lima' }).format(new Date());
  constructor() { this.router.events.subscribe(event => {
    if(event instanceof NavigationStart) this.navigating.set(true);
    if(event instanceof NavigationEnd || event instanceof NavigationCancel || event instanceof NavigationError) this.navigating.set(false);
  }); }
  navigation = [
    { path: '/inicio', label: 'Vista general', icon: 'grid' }, { path: '/parcelas', label: 'Mis parcelas', icon: 'map' },
    { path: '/cultivos', label: 'Cultivos', icon: 'leaf' }, { path: '/planificacion', label: 'Planificación', icon: 'calendar' },
    { path: '/clima', label: 'Clima y pronóstico', icon: 'sun' }, { path: '/produccion', label: 'Cosecha y lotes', icon: 'box' },
    { path: '/alertas', label: 'Alertas', icon: 'bell' }, { path: '/reportes', label: 'Historial y reportes', icon: 'chart' },
  ];
  initials() { const parts=(this.auth.user()?.name || 'A').trim().split(/\s+/).filter(Boolean); return (parts.length > 1 ? parts[0][0]+parts[1][0] : parts[0]?.slice(0,2) || 'AC').toLocaleUpperCase('es-PE'); }
  currentSection() { return this.navigation.find(item => this.router.url.split('?')[0] === item.path)?.label || 'Mi espacio'; }
  async logout() { try { await this.auth.logout(); await this.router.navigateByUrl('/acceso'); } catch(e) { this.error.set(errorMessage(e)); } }
}
