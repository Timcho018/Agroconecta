import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { Router } from '@angular/router';
import { firstValueFrom, catchError, throwError, timeout } from 'rxjs';
import { Entity, User } from './models';

export const apiInterceptor: HttpInterceptorFn = (req, next) => {
  const router = inject(Router);
  return next(req.clone({ withCredentials: true, setHeaders: { 'X-Agro-Request': '1' } })).pipe(catchError((error: HttpErrorResponse) => {
    if (error.status === 401 && !req.url.includes('/auth/')) void router.navigateByUrl('/acceso');
    return throwError(() => error);
  }));
};

export function errorMessage(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    if (!error.status) return 'No se pudo conectar con el servidor. Comprueba que FastAPI esté en ejecución.';
    const detail = error.error?.detail;
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail)) return 'Revisa los campos: ' + detail.map(e => `${e.field || e.loc?.at(-1) || ''} ${e.message || e.msg || ''}`).join('; ');
  }
  if (error instanceof Error && error.name === 'TimeoutError') return 'El servidor tardó demasiado en responder. Comprueba el estado antes de repetir la operación para evitar duplicados.';
  return 'No se pudo completar la operación. Intenta nuevamente.';
}

@Injectable({ providedIn: 'root' })
export class Api {
  private http = inject(HttpClient);
  private cache = new Map<string, {until: number, value: unknown}>();
  private inFlight = new Map<string, Promise<unknown>>();
  private generations = new Map<string, number>();
  get<T>(path: string) {
    // No dejar una pantalla indefinidamente "cargando" si se cae la red.
    return firstValueFrom(this.http.get<T>('/api/' + path).pipe(timeout({first: 16000})));
  }
  post<T>(path: string, body: unknown) { return firstValueFrom(this.http.post<T>('/api/' + path, body).pipe(timeout({first: 25000}))); }
  put<T>(path: string, body: unknown) { return firstValueFrom(this.http.put<T>('/api/' + path, body).pipe(timeout({first: 25000}))); }
  delete<T>(path: string) { return firstValueFrom(this.http.delete<T>('/api/' + path).pipe(timeout({first: 25000}))); }
  async deleteActivity(id: string) { const result = await this.delete<{deleted: boolean; id: string}>(`activities/${encodeURIComponent(id)}`); this.invalidate('activities'); return result; }
  async deleteTemplate(id: string) { const result = await this.delete<{deleted: boolean; id: string}>(`templates/${encodeURIComponent(id)}`); this.invalidate('templates'); return result; }

  cached<T>(path: string, ttlMs = 40000): Promise<T> {
    const existing = this.cache.get(path);
    if (existing && existing.until > Date.now()) return Promise.resolve(existing.value as T);
    const pending = this.inFlight.get(path);
    if (pending) return pending as Promise<T>;
    // Las mutaciones de otras secciones no descartan esta respuesta.
    const generation = this.generations.get(path) ?? 0;
    const request = this.get<T>(path).then(value => {
      if ((this.generations.get(path) ?? 0) === generation) {
        this.cache.set(path, {until: Date.now() + ttlMs, value});
      }
      return value;
    }).finally(() => {
      if (this.inFlight.get(path) === request) this.inFlight.delete(path);
    });
    this.inFlight.set(path, request);
    return request;
  }
  peek<T>(path: string): T | null {
    const existing = this.cache.get(path);
    // Render a recent snapshot immediately during navigation. Each component
    // still calls cached() on entry; if the TTL expired, it fetches fresh data.
    // This avoids full-screen loading placeholders on slow remote connections.
    const maxStaleMs = 15 * 60 * 1000;
    return existing && existing.until + maxStaleMs > Date.now()
      ? existing.value as T : null;
  }
  invalidate(kind?: string) {
    const matching = (key: string) => !kind || key === kind || key === 'summary' ||
      key === 'alerts' || key === 'history' || key.startsWith('weather/');
    const keys = new Set([...this.cache.keys(), ...this.inFlight.keys()]);
    if (!kind) for (const key of this.generations.keys()) keys.add(key);
    for (const key of keys) {
      if (!matching(key)) continue;
      this.cache.delete(key);
      // Evita reutilizar respuestas pendientes después de editar registros.
      this.inFlight.delete(key);
      this.generations.set(key, (this.generations.get(key) ?? 0) + 1);
    }
  }
  list(kind: string) { return this.cached<Entity[]>(kind, 120000); }
  async save(kind: string, value: unknown, id?: string) {
    const result = id ? await this.put<Entity>(`${kind}/${id}`, value) : await this.post<Entity>(kind, value);
    this.invalidate(kind);
    return result;
  }
  async cropPhoto(id: string, file: File) {
    const data = new FormData(); data.append('file', file);
    const result = await this.post<Entity>(`crops/${id}/photo`, data);
    this.invalidate('crops');
    return result;
  }
  async photo(id: string, file: File) {
    const data = new FormData(); data.append('file', file);
    const result = await this.post<Entity>(`plots/${id}/photo`, data);
    this.invalidate('plots');
    return result;
  }
}

@Injectable({ providedIn: 'root' })
export class Auth {
  private api = inject(Api);
  user = signal<User | null>(null);
  async restore() {
    if (this.user()) return true;
    try { this.user.set(await this.api.get<User>('auth/me')); return true; }
    catch { this.user.set(null); this.api.invalidate(); return false; }
  }
  async login(value: unknown) {
    this.api.invalidate();
    this.user.set(await this.api.post<User>('auth/login', value));
  }
  async logout() {
    await this.api.post('auth/logout', {});
    this.user.set(null);
    this.api.invalidate();
  }
}
