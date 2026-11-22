import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { form, FormField, required, email, minLength } from '@angular/forms/signals';
import { Api, Auth, errorMessage } from '../../core/api';
import { Icon } from '../../shared/icon';

@Component({
  selector: 'agro-auth', imports: [FormField, Icon], template: `
    <main class="auth-page">
      <section class="auth-story"><div class="brand"><img class="brand-emblem" src="agroconecta.svg" alt="" />Agroconecta</div>
        <div class="botanical-plate"><div class="story-copy"><h1>La <span>memoria</span><br><em>de tu <span>tierra.</span></em></h1></div>
        <figure class="specimen"><img src="mazorca.png" alt="Ilustración de una mazorca de maíz morado con sus hojas abiertas" /></figure></div>
        
      </section>
      <section class="auth-panel"><div class="auth-box"><span class="eyebrow">Mi cuaderno</span><h2>{{ registering() ? 'Abre tu cuaderno.' : 'Qué bueno verte.' }}</h2><p class="muted">{{ registering() ? 'Crea tu cuenta y registra tu primera parcela.' : 'Ingresa para continuar con tu cuaderno de campo.' }}</p>
        <div class="tabs"><button [attr.aria-pressed]="!registering()" [class.active]="!registering()" (click)="mode(false)">Iniciar sesión</button><button [attr.aria-pressed]="registering()" [class.active]="registering()" (click)="mode(true)">Crear cuenta</button></div>
        <form (submit)="send($event)" novalidate>
          @if(registering()){<label>Tu nombre<span class="entry-control"><agro-icon name="person" /><input [formField]="fields.name" autocomplete="name" placeholder="¿Cómo te llamas?" /></span></label>}
          <label>Correo electrónico<span class="entry-control"><agro-icon name="mail" /><input type="email" [formField]="fields.email" autocomplete="email" placeholder="tu@correo.com" /></span></label>
          <div class="password-field"><label>Contraseña<span class="entry-control"><agro-icon name="lock" /><input [type]="showPassword() ? 'text' : 'password'" [formField]="fields.password" [attr.autocomplete]="registering() ? 'new-password' : 'current-password'" [placeholder]="registering() ? 'Mínimo 12 caracteres' : 'Tu contraseña'" /></span></label>
          <button type="button" class="password-toggle" [attr.aria-label]="showPassword() ? 'Ocultar contraseña' : 'Mostrar contraseña'" (click)="showPassword.set(!showPassword())"><agro-icon [name]="showPassword() ? 'eyeOff' : 'eye'" /></button></div>
          @if(error()){<p class="error" role="alert">{{ error() }}</p>}
          <button class="button auth-submit" type="submit" [disabled]="busy()">{{ busy() ? 'Un momento…' : registering() ? 'Crear mi cuenta' : 'Entrar a mi campo' }} <agro-icon name="arrow" /></button>
        </form><p class="auth-note"><agro-icon name="lock" />Tus registros de campo son privados.</p>
      </div></section>
    </main>`,
})
export class AuthPage {
  api = inject(Api); auth = inject(Auth); router = inject(Router);
  registering = signal(false); busy = signal(false); error = signal(''); showPassword = signal(false);
  model = signal({ name: '', email: '', password: '' });
  fields = form(this.model, p => { required(p.email); email(p.email); required(p.password); minLength(p.password, 12); });
  mode(value: boolean) { if (!this.busy()) { this.registering.set(value); this.error.set(''); } }
  async send(event: Event) {
    event.preventDefault(); if (this.busy()) return;
    if (this.fields().invalid() || (this.registering() && this.model().name.trim().length < 2)) { this.error.set('Ingresa un correo válido, una contraseña de al menos 12 caracteres y tu nombre si estás creando una cuenta.'); return; }
    this.busy.set(true); this.error.set('');
    try {
      const value = this.model();
      if (this.registering()) await this.api.post('auth/register', value);
      await this.auth.login({ email: value.email, password: value.password });
      this.model.update(v => ({ ...v, password: '' })); await this.router.navigateByUrl('/inicio');
    } catch(e) { this.error.set(errorMessage(e)); } finally { this.busy.set(false); }
  }
}
