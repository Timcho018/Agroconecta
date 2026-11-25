import base64
from datetime import datetime, timezone
from uuid import uuid4

from fastapi import HTTPException

from services.storage_media import StorageUnavailable

from repositories.store import Store


def now():
    # UTC timestamps; user-facing calendar dates are explicitly Peru dates.
    return datetime.now(timezone.utc).isoformat()


class FarmService:
    def __init__(self, store: Store, media=None):
        self.store = store
        self.media = media

    @staticmethod
    def owned(data, owner, kind, record_id):
        record = data["records"].get(record_id)
        if not record or record["owner"] != owner or record["kind"] != kind:
            raise HTTPException(404, "Registro no encontrado.")
        return record

    @staticmethod
    def public(record):
        return {k: v for k, v in record.items() if k not in ("owner", "kind", "photo", "photo_path", "crop_photo_path", "crop_photo_b64")}

    @staticmethod
    def audit(data, owner, record, action):
        # Snapshot the parcel association: activity records can later be deleted.
        parcel_id = record['id'] if record['kind'] == 'plots' else record.get('plot_id')
        data["events"].append({"id": str(uuid4()), "owner": owner, "record_id": record["id"],
                               "plot_id": parcel_id, "kind": record["kind"],
                               "label": record.get("name", record.get("title", record.get("code", "Registro"))),
                               "action": action, "date": now()})

    def list(self, owner, kind):
        if hasattr(self.store, 'list_records'):
            return [self.public(r) for r in self.store.list_records(owner, kind)]
        return [self.public(r) for r in self.store.read()["records"].values() if r["owner"] == owner and r["kind"] == kind]

    def get(self, owner, kind, record_id):
        if hasattr(self.store, 'get_record'):
            return self.public(self.store.get_record(owner, kind, record_id))
        return self.public(self.owned(self.store.read(), owner, kind, record_id))

    def save(self, owner, kind, values, record_id=None):
        # Al elegir una imagen externa, borrar el objeto antiguo DESPUÉS de
        # confirmar la actualización; nunca romper la transacción por un fallo
        # de limpieza de Storage.
        old_path = None
        if kind == 'crops' and record_id and values.get('image_source') != 'custom':
            old_record = (self.store.get_record(owner, 'crops', record_id)
                          if hasattr(self.store, 'get_record') else
                          self.owned(self.store.read(), owner, 'crops', record_id))
            old_path = old_record.get('crop_photo_path')
        def change(data):
            old = self.owned(data, owner, kind, record_id) if record_id else None
            if kind == "harvests" and old:
                raise HTTPException(405, "La cosecha conserva su registro inicial; utiliza las etapas del lote.")
            if kind == "plots" and values.get("crop_id"):
                crop = self.owned(data, owner, "crops", values["crop_id"])
                if not crop.get("active", True) and (not old or old.get("crop_id") != values["crop_id"]):
                    raise HTTPException(409, "Selecciona un cultivo activo.")
            if kind == 'harvests' and values.get('process_template_id'):
                template = self.owned(data, owner, 'templates', values['process_template_id'])
                if template.get('purpose') != 'harvest':
                    raise HTTPException(422, 'Selecciona una plantilla de procesos válida.')
                values['process_template_name'] = template.get('name')
                if values.get('process_steps') is None:
                    values['process_steps'] = list(template.get('steps', []))
            if kind in ("activities", "harvests"):
                plot = self.owned(data, owner, "plots", values["plot_id"])
                if not plot["active"] and (not old or old["plot_id"] != values["plot_id"]):
                    raise HTTPException(409, "Selecciona una parcela activa.")
            record = dict(old or {}, **values)
            if kind == 'crops' and old and values.get('image_source') != 'custom':
                # No conservar una fotografía privada si el agricultor cambia a iNaturalist.
                record.pop('crop_photo_b64', None)
                record.pop('crop_photo_path', None)
                record.pop('crop_photo_version', None)
            record.update(id=record_id or str(uuid4()), owner=owner, kind=kind, updated_at=now())
            if not old:
                record["created_at"] = now()
            if kind == "harvests":
                first = {"stage": "Cosechado", "quantity": values["quantity"], "date": now(), "notes": values["notes"]}
                steps = values.get('process_steps')
                crop_record = data['records'].get(plot.get('crop_id')) if plot.get('crop_id') else None
                # Existing API clients retain the legacy process, while the
                # constructor sends a snapshot of its individually chosen steps.
                is_custom = steps is not None
                # Global uniqueness is enforced by the normalized schema. Twelve
                # UUID hex characters keep the existing LOT- appearance while
                # avoiding the 32-bit collision risk of the legacy 8-char code.
                record.update(code="LOT-" + record["id"][:12].upper(), stage="Cosechado",
                              current_quantity=values["quantity"], crop_id=plot.get("crop_id", ""),
                              crop_name_historical=crop_record.get('name') if crop_record else None,
                              variety_historical=crop_record.get('variety') if crop_record else None,
                              stages=[first], process_mode='custom' if is_custom else 'legacy',
                              process_steps=['Cosechado', *(steps if is_custom else
                                              ['Procesamiento','Secado','Almacenado']), 'Cerrado'])
                if is_custom:
                    record['stage_history'] = [first]
            data["records"][record["id"]] = record
            self.audit(data, owner, record, "Actualizado" if old else "Registrado")
            return self.public(record)
        if hasattr(self.store, 'transaction_scoped'):
            depends = ['crops'] if kind == 'plots' else ['plots', 'templates'] if kind == 'harvests' else ['plots'] if kind == 'activities' else []
            result = self.store.transaction_scoped(owner, [kind, *depends], change)
        else:
            result = self.store.transaction(change)
        if old_path and self.media:
            self.media.best_effort_delete(owner, 'cultivos', record_id, old_path)
        return result

    def delete_activity(self, owner, record_id):
        """Elimina únicamente una actividad propia, conservando la trazabilidad."""
        def change(data):
            record = self.owned(data, owner, 'activities', record_id)
            self.audit(data, owner, record, 'Eliminado')
            del data['records'][record_id]
            return {'deleted': True, 'id': record_id}
        if hasattr(self.store, 'transaction_scoped'):
            return self.store.transaction_scoped(owner, ('activities',), change)
        return self.store.transaction(change)

    def delete_template(self, owner, record_id):
        """Borra una plantilla propia sin modificar las actividades ya programadas."""
        def change(data):
            record = self.owned(data, owner, 'templates', record_id)
            self.audit(data, owner, record, 'Eliminado')
            del data['records'][record_id]
            return {'deleted': True, 'id': record_id}
        if hasattr(self.store, 'transaction_scoped'):
            return self.store.transaction_scoped(owner, ('templates',), change)
        return self.store.transaction(change)

    def stage(self, owner, record_id, values):
        def change(data):
            record = self.owned(data, owner, "harvests", record_id)
            stages = record.get('process_steps') or ["Cosechado", "Procesamiento", "Secado", "Almacenado", "Cerrado"]
            try:
                next_stage = stages[stages.index(record['stage']) + 1]
            except (ValueError, IndexError):
                raise HTTPException(409, 'El lote ya terminó o tiene una etapa inválida.')
            if values['stage'] != next_stage:
                raise HTTPException(409, 'Solo puedes avanzar a la siguiente etapa de este lote.')
            if values["quantity"] > record["current_quantity"]:
                raise HTTPException(422, "La cantidad no puede superar la cantidad de la etapa anterior.")
            event = dict(values, date=now())
            record.update(stage=values["stage"], current_quantity=values["quantity"], updated_at=now())
            record['stages'].append(event)
            if record.get('process_mode') == 'custom':
                # JsonStore retains this compatibility alias. PostgreSQL maps
                # the same history into etapas_cosecha for every process type.
                record['stage_history'] = list(record['stages'])
            self.audit(data, owner, record, "Etapa: " + values["stage"])
            return self.public(record)
        if hasattr(self.store, 'transaction_scoped'):
            return self.store.transaction_scoped(owner, ('harvests',), change)
        return self.store.transaction(change)

    def _uploaded_media(self, owner, kind, record_id, content):
        if not self.media:
            raise HTTPException(503, 'Configura Supabase Storage en el backend antes de subir fotografías.')
        try:
            return self.media.verified_upload(owner, kind, record_id, content)
        except (StorageUnavailable, ValueError) as exc:
            raise HTTPException(503, str(exc)) from exc

    def _read_media(self, owner, kind, record_id, path):
        if not self.media:
            raise HTTPException(503, 'Configura Supabase Storage para visualizar esta fotografía.')
        try:
            return self.media.download(owner, kind, record_id, path)
        except (StorageUnavailable, ValueError) as exc:
            raise HTTPException(503, str(exc)) from exc

    def photo(self, owner, record_id, content=None):
        """Fotografía privada de parcela almacenada exclusivamente en Storage."""
        if content is None:
            record = (self.store.get_record(owner, 'plots', record_id) if hasattr(self.store, 'get_record')
                      else self.owned(self.store.read(), owner, 'plots', record_id))
            if record.get('photo_path'):
                return self._read_media(owner, 'parcelas', record_id, record['photo_path'])
            # Almacén de pruebas en memoria; PostgreSQL nunca lee bytes de sus tablas.
            if not hasattr(self.store, 'transaction_scoped') and record.get('photo'):
                return base64.b64decode(record['photo'])
            raise HTTPException(404, 'La parcela no tiene fotografía en Storage.')

        if self.media:
            # Verificar propiedad antes de subir bytes y de nuevo al confirmar SQL.
            original = (self.store.get_record(owner, 'plots', record_id)
                        if hasattr(self.store, 'get_record') else
                        self.owned(self.store.read(), owner, 'plots', record_id))
            old_path = original.get('photo_path')
            path = self._uploaded_media(owner, 'parcelas', record_id, content)
            try:
                def change(data):
                    record = self.owned(data, owner, 'plots', record_id)
                    record['photo_path'] = path
                    record['photo_version'] = str(uuid4())
                    record.pop('photo', None)
                    self.audit(data, owner, record, 'Fotografía actualizada')
                    return self.public(record)

                if hasattr(self.store, 'transaction_scoped'):
                    result = self.store.transaction_scoped(owner, ('plots',), change)
                else:
                    result = self.store.transaction(change)
            except Exception:
                self.media.best_effort_delete(owner, 'parcelas', record_id, path)
                raise
            if old_path:
                self.media.best_effort_delete(owner, 'parcelas', record_id, old_path)
            return result

        # Solo pruebas locales con JsonStore; NO escribir fotografías en PostgreSQL.
        if hasattr(self.store, 'set_photo'):
            raise HTTPException(503, 'Configura Supabase Storage antes de subir fotografías.')

        def change(data):
            record = self.owned(data, owner, 'plots', record_id)
            record['photo_version'] = str(uuid4())
            record['photo'] = base64.b64encode(content).decode()
            self.audit(data, owner, record, 'Fotografía actualizada')
            return self.public(record)
        return self.store.transaction(change)

    def crop_photo(self, owner, record_id, content=None):
        """Fotografía de cultivo en bucket privado; soporta migración desde JSONB."""
        if content is None:
            record = (self.store.get_record(owner, 'crops', record_id)
                      if hasattr(self.store, 'get_record')
                      else self.owned(self.store.read(), owner, 'crops', record_id))
            if record.get('crop_photo_path'):
                return self._read_media(owner, 'cultivos', record_id, record['crop_photo_path'])
            photo = record.get('crop_photo_b64')
            if not photo:
                raise HTTPException(404, 'Este cultivo no tiene fotografía propia.')
            return base64.b64decode(photo)

        if self.media:
            original = (self.store.get_record(owner, 'crops', record_id)
                        if hasattr(self.store, 'get_record')
                        else self.owned(self.store.read(), owner, 'crops', record_id))
            old_path = original.get('crop_photo_path')
            path = self._uploaded_media(owner, 'cultivos', record_id, content)
            try:
                def change(data):
                    record = self.owned(data, owner, 'crops', record_id)
                    record['crop_photo_path'] = path
                    record.pop('crop_photo_b64', None)
                    record['crop_photo_version'] = str(uuid4())
                    record['image_source'] = 'custom'
                    record['image_url'] = ''
                    record['image_credit'] = ''
                    record['image_license'] = ''
                    record['image_taxon_id'] = None
                    record['updated_at'] = now()
                    self.audit(data, owner, record, 'Fotografía del cultivo actualizada')
                    return self.public(record)
                if hasattr(self.store, 'transaction_scoped'):
                    result = self.store.transaction_scoped(owner, ('crops',), change)
                else:
                    result = self.store.transaction(change)
            except Exception:
                self.media.best_effort_delete(owner, 'cultivos', record_id, path)
                raise
            if old_path:
                self.media.best_effort_delete(owner, 'cultivos', record_id, old_path)
            return result

        if hasattr(self.store, 'get_record'):
            raise HTTPException(503, 'Configura Supabase Storage antes de subir fotografías.')

        def change(data):
            record = self.owned(data, owner, 'crops', record_id)
            record['crop_photo_b64'] = base64.b64encode(content).decode('ascii')
            record['crop_photo_version'] = str(uuid4())
            record['image_source'] = 'custom'
            record['image_url'] = ''
            record['image_credit'] = ''
            record['image_license'] = ''
            record['image_taxon_id'] = None
            record['updated_at'] = now()
            self.audit(data, owner, record, 'Fotografía del cultivo actualizada')
            return self.public(record)
        return self.store.transaction(change)

    def history(self, owner):
        if hasattr(self.store, 'events_for'):
            return self.store.events_for(owner)
        return [{k: v for k, v in e.items() if k != "owner"} for e in reversed(self.store.read()["events"]) if e["owner"] == owner]

    def summary(self, owner):
        if hasattr(self.store, 'summary_for'):
            return self.store.summary_for(owner)
        plots, tasks, lots = (self.list(owner, kind) for kind in ("plots", "activities", "harvests"))
        return {"active_plots": sum(p["active"] for p in plots),
                "area": sum(p["area"] for p in plots if p["active"]),
                "pending": sum(t["status"] in ("Pendiente", "En curso") for t in tasks),
                "harvest_kg": sum(h["quantity"] for h in lots),
                "current_kg": sum(h["current_quantity"] for h in lots),
                "completed": sum(t["status"] == "Completada" for t in tasks)}
