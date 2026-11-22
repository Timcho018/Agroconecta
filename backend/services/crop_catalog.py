"""Búsqueda real de plantas en iNaturalist, con cache y límites respetuosos.

Los alias solo traducen términos agrícolas peruanos: nombre, especie e imagen
provienen de iNaturalist. Ninguna respuesta simulada se presenta como dato real.
"""
import asyncio
import re
import time
import unicodedata
from urllib.parse import urlparse

import httpx

# Equivalencias lingüísticas para que los nombres usados en Perú encuentren su taxón.
# NO es un catálogo de productos ni almacena fotografías o resultados.
ALIASES = {
    'papa': ('Solanum tuberosum', 'Papa'), 'papas': ('Solanum tuberosum','Papa'),
    'patata': ('Solanum tuberosum','Papa'), 'camote': ('Ipomoea batatas','Camote'),
    'maiz': ('Zea mays','Maíz'), 'choclo': ('Zea mays','Maíz'),
    'cafe': ('Coffea arabica','Café'), 'cafeto': ('Coffea arabica','Café'),
    'cacao': ('Theobroma cacao','Cacao'), 'palta': ('Persea americana','Palta'),
    'aguacate': ('Persea americana','Palta'), 'platano': ('Musa paradisiaca','Plátano'),
    'banana': ('Musa acuminata','Banano'), 'banano': ('Musa acuminata','Banano'),
    'yuca': ('Manihot esculenta','Yuca'), 'mandioca': ('Manihot esculenta','Yuca'),
    'arroz': ('Oryza sativa','Arroz'), 'quinua': ('Chenopodium quinoa','Quinua'),
    'quinoa': ('Chenopodium quinoa','Quinua'), 'kiwicha': ('Amaranthus caudatus','Kiwicha'),
    'fresa': ('Fragaria ananassa','Fresa'), 'mango': ('Mangifera indica','Mango'),
    'naranja': ('Citrus sinensis','Naranja'), 'limon': ('Citrus limon','Limón'),
    'mandarina': ('Citrus reticulata','Mandarina'), 'papaya': ('Carica papaya','Papaya'),
    'pina': ('Ananas comosus','Piña'), 'maracuya': ('Passiflora edulis','Maracuyá'),
    'granadilla': ('Passiflora ligularis','Granadilla'), 'uva': ('Vitis vinifera','Uva'),
    'cebolla': ('Allium cepa','Cebolla'), 'ajo': ('Allium sativum','Ajo'),
    'tomate': ('Solanum lycopersicum','Tomate'), 'lechuga': ('Lactuca sativa','Lechuga'),
    'zanahoria': ('Daucus carota','Zanahoria'), 'zapallo': ('Cucurbita maxima','Zapallo'),
    'frejol': ('Phaseolus vulgaris','Frijol'), 'frijol': ('Phaseolus vulgaris','Frijol'),
    'frijoles': ('Phaseolus vulgaris','Frijol'), 'haba': ('Vicia faba','Haba'),
    'arveja': ('Pisum sativum','Arveja'), 'soya': ('Glycine max','Soya'),
    'algodon': ('Gossypium hirsutum','Algodón'), 'trigo': ('Triticum aestivum','Trigo'),
    'cebada': ('Hordeum vulgare','Cebada'), 'avena': ('Avena sativa','Avena'),
    'oregano': ('Origanum vulgare','Orégano'), 'mani': ('Arachis hypogaea','Maní'),
}
ALLOWED_LICENSES = {'cc0','cc-by','cc-by-sa','cc-by-nc','cc-by-nc-sa'}
PHOTO_DOMAINS = {'static.inaturalist.org', 'inaturalist-open-data.s3.amazonaws.com'}


def normalize(value: str) -> str:
    return ''.join(c for c in unicodedata.normalize('NFKD', value.casefold()) if not unicodedata.combining(c)).strip()


def clean_photo(raw: dict | None):
    if not isinstance(raw, dict):
        return {'url':'', 'attribution':'', 'license':''}
    url = str(raw.get('url') or raw.get('medium_url') or '')
    license_code = str(raw.get('license_code') or '').lower()
    parsed = urlparse(url)
    if parsed.scheme != 'https' or parsed.hostname not in PHOTO_DOMAINS or license_code not in ALLOWED_LICENSES:
        return {'url':'', 'attribution':'', 'license':''}
    # La API suele devolver square.jpg, insuficiente para la tarjeta grande.
    url = re.sub(r'/square\.(jpg|jpeg|png)$', r'/medium.\1', url, flags=re.I)
    return {'url':url,'attribution':str(raw.get('attribution') or 'iNaturalist')[:350], 'license':license_code}


class CropCatalog:
    def __init__(self, client=None, clock=None):
        self.client = client or httpx.AsyncClient(timeout=5, headers={'User-Agent':'AgroConecta/0.3 (cultivos; uso educativo)'})
        self.owns_client = client is None
        self.clock = clock or time.monotonic
        self.lock = asyncio.Lock()
        self.last_external = -100.0
        self.cache = {}
        self.photo_cache = {}

    async def close(self):
        if self.owns_client:
            await self.client.aclose()

    async def search(self, query: str):
        query = query.strip()
        key = normalize(query)
        if len(key) < 2:
            return []
        translated, friendly = ALIASES.get(key, (query, None))
        # Resolver fragmentos de nombres agrícolas sin depender de que el usuario
        # escriba la palabra entera: «caca» -> cacao -> Theobroma cacao.
        # Si el prefijo es ambiguo (p. ej. «ca»), se consulta iNaturalist tal cual.
        if friendly is None and len(key) >= 3:
            candidates = {(scientific, display) for alias, (scientific, display) in ALIASES.items() if alias.startswith(key)}
            species = {item[0] for item in candidates}
            if len(species) == 1:
                scientific = next(iter(species))
                translated = scientific
                friendly = next((display for alias, (taxon, display) in ALIASES.items()
                                 if alias == key and taxon == scientific), None)
                if not friendly:
                    # Preferir el nombre común más corto de las equivalencias.
                    friendly = min((display for taxon, display in candidates if taxon == scientific),key=len)
        cache_key = normalize(translated)
        async with self.lock:
            cached = self.cache.get(cache_key)
            if cached and cached[0] > self.clock():
                if friendly:
                    return [{**item, 'name':friendly} if item['scientific_name'].casefold()==translated.casefold() else item
                            for item in cached[1]]
                return cached[1]
            await asyncio.sleep(max(0.0, 1.05 - (self.clock() - self.last_external)))
            self.last_external = self.clock()
            response = await self.client.get('https://api.inaturalist.org/v1/taxa/autocomplete', params={
                'q':translated, 'locale':'es', 'per_page':15,
            })
            response.raise_for_status()
            data = response.json()
            matches = []
            seen = set()
            for taxon in data.get('results', []):
                if not isinstance(taxon,dict) or taxon.get('iconic_taxon_name') != 'Plantae':
                    continue
                if taxon.get('rank') not in ('species','subspecies','variety'):
                    continue
                taxon_id = taxon.get('id')
                if not isinstance(taxon_id,int) or taxon_id in seen:continue
                seen.add(taxon_id)
                scientific = str(taxon.get('name') or '').strip()
                # El nombre preferido es español cuando iNat dispone de la traducción.
                common = (friendly if friendly and scientific.casefold() == translated.casefold()
                          else str(taxon.get('preferred_common_name') or scientific))
                photo = clean_photo(taxon.get('default_photo'))
                matches.append({'id': taxon_id, 'name': common[:100], 'scientific_name': scientific[:150],
                                'image_url': photo['url'], 'image_credit': photo['attribution'],
                                'image_license': photo['license'], 'source': 'iNaturalist'})
            self.cache[cache_key] = (self.clock() + 900, matches[:12])
            # Evita crecimiento indefinido del caché en procesos muy largos.
            if len(self.cache) > 400:
                self.cache = {k:v for k,v in self.cache.items() if v[0] > self.clock()}
            return matches[:12]

    async def photos(self, taxon_id: int):
        """Hasta ocho fotografías licenciadas de observaciones de iNaturalist.

        Son referencias a la *especie*, no pruebas de identidad de una variedad.
        La selección de fotografía la realiza el agricultor.
        """
        if not 1 <= taxon_id <= 2_147_483_647:
            raise ValueError('Identificador inválido')
        async with self.lock:
            cached = self.photo_cache.get(taxon_id)
            if cached and cached[0] > self.clock():
                return cached[1]
            # Mismo límite respetuoso de las búsquedas normales.
            await asyncio.sleep(max(0.0, 1.05 - (self.clock() - self.last_external)))
            self.last_external = self.clock()
            response = await self.client.get('https://api.inaturalist.org/v1/observations', params={
                'taxon_id': taxon_id, 'photos': 'true', 'quality_grade': 'research',
                'per_page': 25, 'order': 'desc', 'order_by': 'votes',
            })
            response.raise_for_status()
            choices = []
            seen = set()
            for observation in response.json().get('results', []):
                if not isinstance(observation, dict):
                    continue
                obs_id = observation.get('id')
                if not isinstance(obs_id,int) or obs_id < 1:
                    continue
                for raw in observation.get('photos') or []:
                    photo = clean_photo(raw)
                    url = photo['url']
                    if not url or url in seen:
                        continue
                    seen.add(url)
                    choices.append({'url': url, 'credit': photo['attribution'],
                                    'license': photo['license'],
                                    'observation_url': f'https://www.inaturalist.org/observations/{obs_id}'})
                    if len(choices) >= 8:
                        break
                if len(choices) >= 8:
                    break
            self.photo_cache[taxon_id] = (self.clock() + 1800, choices)
            if len(self.photo_cache) > 150:
                self.photo_cache = {k:v for k,v in self.photo_cache.items() if v[0] > self.clock()}
            return choices
