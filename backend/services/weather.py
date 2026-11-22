import asyncio
import time
from datetime import datetime, timedelta, timezone

import httpx
from fastapi import HTTPException


class WeatherService:
    def __init__(self):
        self.cache = {}
        self.limit = asyncio.Semaphore(4)

    async def forecast(self, plot):
        key = (plot["latitude"], plot["longitude"])
        cached = self.cache.get(key)
        if cached and time.monotonic() - cached[0] < 900:
            return dict(cached[1], cached=True)
        async with self.limit:
            try:
                async with httpx.AsyncClient(timeout=15) as client:
                    response = await client.get("https://api.open-meteo.com/v1/forecast", params={
                        "latitude": key[0], "longitude": key[1], "timezone": "America/Lima", "forecast_days": 7,
                        "daily": "temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,weather_code"})
                    response.raise_for_status()
                    daily = response.json()["daily"]
                days = [{"date": day, "max": daily["temperature_2m_max"][i], "min": daily["temperature_2m_min"][i],
                         "rain_probability": daily["precipitation_probability_max"][i], "rain_mm": daily["precipitation_sum"][i],
                         "code": daily["weather_code"][i]} for i, day in enumerate(daily["time"])]
                result = {"source": "Open-Meteo", "source_url": "https://open-meteo.com/", "timezone": "America/Lima",
                          "fetched_at": datetime.now(timezone.utc).isoformat(), "cached": False, "days": days}
                if len(self.cache) >= 500:
                    self.cache.clear()
                self.cache[key] = (time.monotonic(), result)
                return result
            except (httpx.HTTPError, KeyError, ValueError, TypeError, IndexError):
                raise HTTPException(502, "No se pudo consultar Open-Meteo. Intenta nuevamente; no se muestran pronósticos inventados.")

    async def alerts(self, farm, owner):
        today = datetime.now(timezone(timedelta(hours=-5))).date().isoformat()
        plots = [p for p in farm.list(owner, "plots") if p["active"]]
        tasks, lots = farm.list(owner, "activities"), farm.list(owner, "harvests")
        alerts, unavailable = [], []
        for task in tasks:
            if task["status"] in ("Pendiente", "En curso") and task["date"] < today:
                alerts.append({"id": "task-" + task["id"], "type": "Actividad", "title": "Actividad vencida: " + task["title"],
                               "detail": "Programada para " + task["date"] + ". Revisa su estado.", "plot_id": task["plot_id"], "date": task["date"]})

        async def check(plot):
            try:
                weather = await self.forecast(plot)
            except HTTPException:
                unavailable.append(plot["name"])
                return
            for day in weather["days"]:
                if day["rain_probability"] is not None and day["rain_probability"] >= 70:
                    linked = [t["title"] for t in tasks if t["plot_id"] == plot["id"] and t["date"] == day["date"] and t["status"] in ("Pendiente", "En curso")]
                    drying = [h["code"] for h in lots if h["plot_id"] == plot["id"] and h["stage"] == "Secado"]
                    if linked or drying:
                        alerts.append({"id": plot["id"] + day["date"], "type": "Pronóstico", "title": "Lluvia probable · " + plot["name"],
                                       "detail": f"{day['rain_probability']}% el {day['date']}. Coincide con: " + ", ".join(linked + drying) + ". Revisa las condiciones reales.",
                                       "date": day["date"], "plot_id": plot["id"]})
        # No consultar Open-Meteo para parcelas que no tienen ninguna labor
        # susceptible de aviso meteorológico ni lotes en secado. Antes se
        # hacía una petición por cada parcela, incluso sin nada que alertar.
        forecast_end = (datetime.now(timezone(timedelta(hours=-5))).date() + timedelta(days=6)).isoformat()
        relevant_plot_ids = {
            task['plot_id'] for task in tasks
            if task['status'] in ('Pendiente', 'En curso') and today <= task['date'] <= forecast_end
        }
        relevant_plot_ids.update(lot['plot_id'] for lot in lots if lot['stage'] == 'Secado')
        await asyncio.gather(*(check(p) for p in plots if p['id'] in relevant_plot_ids))
        # El estado de revisión es privado para cada cuenta; el aviso se evalúa
        # nuevamente a partir de los datos actuales y del pronóstico disponible.
        if hasattr(farm.store, 'read_reviews'):
            reviews = farm.store.read_reviews(owner)
        else:
            reviews = farm.store.read().get("alert_reviews", {}).get(owner, {})
        for alert in alerts:
            alert["reviewed"] = bool(reviews.get(alert["id"], False))
        return {"items": sorted(alerts, key=lambda a: (a["date"], a["id"])), "unavailable": unavailable,
                "rule": "Avisos informativos: actividades vencidas y lluvia ≥70% coincidente con actividades pendientes o lotes en secado. No son recomendaciones agronómicas."}

    async def review(self, farm, owner: str, alert_id: str, reviewed: bool):
        # No permitir manipular IDs arbitrarios ni avisos pertenecientes a otro usuario.
        current = await self.alerts(farm, owner)
        if not any(item["id"] == alert_id for item in current["items"]):
            raise HTTPException(404, "Aviso no encontrado o ya no vigente.")

        def update(data):
            by_owner = data.setdefault("alert_reviews", {}).setdefault(owner, {})
            if reviewed:
                by_owner[alert_id] = True
            else:
                by_owner.pop(alert_id, None)
            return {"id": alert_id, "reviewed": reviewed}

        if hasattr(farm.store, 'set_review'):
            return farm.store.set_review(owner, alert_id, reviewed)
        return farm.store.transaction(update)
