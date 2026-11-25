export interface User { id: string; name: string; email: string }
export interface StageEvent { stage: string; quantity: number; date: string; notes: string }
export interface Entity {
  id: string; created_at?: string; updated_at?: string; name: string; title: string; location: string; area: number;
  latitude: number; longitude: number; crop_id: string; plot_id: string;
  soil: string; notes: string; active: boolean; photo_version: string;
  variety: string; cycle_days: number; image_source?: string; image_url?: string; image_credit?: string; image_license?: string; image_taxon_id?: number | null; crop_photo_version?: string; date: string; category: string; status: string;
  quantity: number; current_quantity: number; stage: string; code: string; stages: StageEvent[];
  process_steps?: string[]; process_mode?: string; purpose?: 'activity'|'harvest'; steps?: string[];
  process_template_id?: string; process_template_name?: string;
  crop_name_historical?: string; variety_historical?: string;
}
export interface Summary { active_plots: number; area: number; pending: number; harvest_kg: number; current_kg: number; completed: number }
export interface ForecastDay { date: string; max: number | null; min: number | null; rain_probability: number | null; rain_mm: number | null; code: number | null }
export interface Forecast { source: string; source_url: string; fetched_at: string; cached: boolean; days: ForecastDay[] }
export interface FarmAlert { id: string; type: string; title: string; detail: string; plot_id: string; date: string; reviewed: boolean }
export interface Alerts { items: FarmAlert[]; unavailable: string[]; rule: string }
export interface HistoryEvent { id: string; record_id?: string; plot_id?: string | null; kind: string; label: string; action: string; date: string }
export interface FieldSpec { key: string; label: string; type?: 'text' | 'number' | 'date' | 'textarea' | 'select' | 'email' | 'password'; required?: boolean; min?: number; max?: number; minLength?: number; integer?: boolean; options?: { value: string; label: string }[]; suggestions?: string[]; hint?: string }
export function peruToday(): string { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
