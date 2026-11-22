from datetime import date, datetime, timedelta, timezone
from urllib.parse import urlparse
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator, model_validator


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True, allow_inf_nan=False)


class Login(Model):
    email: str = Field(min_length=5, max_length=254, pattern=r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
    password: Annotated[str, StringConstraints(strip_whitespace=False)] = Field(min_length=12, max_length=128)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value):
        return value.casefold()


class Register(Login):
    name: str = Field(min_length=2, max_length=80)


class Crop(Model):
    name: str = Field(min_length=2, max_length=100)
    variety: str = Field(default="", max_length=100)
    cycle_days: int = Field(default=0, ge=0, le=3650)
    notes: str = Field(default="", max_length=2000)
    active: bool = True
    image_source: Literal["", "inaturalist", "custom"] = ""
    image_url: str = Field(default="", max_length=600)
    image_credit: str = Field(default="", max_length=350)
    image_license: str = Field(default="", max_length=30)
    image_taxon_id: int | None = Field(default=None, ge=1)

    @field_validator("image_url")
    @classmethod
    def trusted_photo(cls, value):
        if not value:
            return value
        url = urlparse(value)
        if url.scheme != 'https' or url.hostname not in (
            'static.inaturalist.org', 'inaturalist-open-data.s3.amazonaws.com'
        ):
            raise ValueError('La imagen externa debe provenir de iNaturalist.')
        return value


class Plot(Model):
    name: str = Field(min_length=2, max_length=100)
    location: str = Field(min_length=2, max_length=160)
    area: float = Field(gt=0, le=100000)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    crop_id: str = ""
    soil: str = Field(default="", max_length=200)
    notes: str = Field(default="", max_length=2000)
    active: bool = True


class Activity(Model):
    title: str = Field(min_length=2, max_length=160)
    plot_id: str
    date: date
    category: Literal["Inspección", "Mantenimiento", "Siembra", "Cosecha", "Poscosecha", "Otra"] = "Otra"
    status: Literal["Pendiente", "En curso", "Completada", "Cancelada"] = "Pendiente"
    notes: str = Field(default="", max_length=2000)


class Harvest(Model):
    plot_id: str
    date: date
    quantity: float = Field(gt=0, le=100000000)
    notes: str = Field(default="", max_length=2000)
    # None preserves the existing five-stage process for older clients and lots.
    # [] means a direct Cosecha -> Cierre workflow; names are authored by the user.
    process_steps: list[str] | None = Field(default=None, max_length=10)
    process_template_id: str = ""

    @field_validator('process_steps')
    @classmethod
    def valid_steps(cls, values):
        if values is None:
            return None
        normalized = [str(value).strip() for value in values]
        if any(not 2 <= len(value) <= 64 or value.casefold() in ('cosechado', 'cerrado') for value in normalized):
            raise ValueError('Cada etapa debe tener entre 2 y 64 caracteres y no puede ser Cosechado ni Cerrado.')
        if len({value.casefold() for value in normalized}) != len(normalized):
            raise ValueError('No repitas etapas dentro del mismo proceso.')
        return normalized

    @field_validator("date")
    @classmethod
    def not_future(cls, value):
        if value > datetime.now(timezone(timedelta(hours=-5))).date():
            raise ValueError("La cosecha no puede tener una fecha futura.")
        return value


class Stage(Model):
    stage: str = Field(min_length=2, max_length=64)
    quantity: float = Field(ge=0, le=100000000)
    notes: str = Field(default="", max_length=2000)


class Template(Model):
    name: str = Field(min_length=2, max_length=100)
    purpose: Literal['activity', 'harvest'] = 'activity'
    steps: list[str] = Field(default_factory=list, max_length=10)

    @field_validator('steps')
    @classmethod
    def valid_template_steps(cls, value):
        return Harvest.valid_steps(value)

    title: str = Field(min_length=2, max_length=160)
    category: Literal["Inspección", "Mantenimiento", "Siembra", "Cosecha", "Poscosecha", "Otra"] = "Otra"
    notes: str = Field(default="", max_length=2000)

    @model_validator(mode='after')
    def template_rules(self):
        if self.purpose == 'harvest' and not self.steps:
            raise ValueError('Una plantilla de proceso debe contener al menos una etapa intermedia.')
        return self


MODELS = {"plots": Plot, "crops": Crop, "activities": Activity, "harvests": Harvest, "templates": Template}
