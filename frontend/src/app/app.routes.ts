import { Routes, Router } from '@angular/router';
import { inject } from '@angular/core';
import { Auth } from './core/api';

export const routes: Routes = [
  { path: 'acceso', loadComponent: () => import('./features/auth/auth').then(m => m.AuthPage) },
  { path: '', loadComponent: () => import('./shared/shell').then(m => m.Shell), canActivate: [async () => { const auth=inject(Auth), router=inject(Router); return await auth.restore() || router.parseUrl('/acceso'); }], children: [
    {path:'inicio',loadComponent:()=>import('./features/home/dashboard').then(m=>m.Dashboard)},
    {path:'parcelas',loadComponent:()=>import('./features/plots/plots').then(m=>m.Plots)},
    {path:'cultivos',loadComponent:()=>import('./features/crops/crops').then(m=>m.Crops)},
    {path:'planificacion',loadComponent:()=>import('./features/planning/planning').then(m=>m.Planning)},
    {path:'clima',loadComponent:()=>import('./features/weather/weather').then(m=>m.Weather)},
    {path:'produccion',loadComponent:()=>import('./features/production/production').then(m=>m.Production)},
    {path:'alertas',loadComponent:()=>import('./features/alerts/alerts').then(m=>m.Alerts)},
    {path:'reportes',loadComponent:()=>import('./features/reports/reports').then(m=>m.Reports)},
    {path:'',pathMatch:'full',redirectTo:'inicio'},
  ]},
  { path: '**', redirectTo: 'inicio' },
];
