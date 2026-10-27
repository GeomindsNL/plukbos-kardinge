#!/usr/bin/env python3
"""Zet een Boomwacht-export om naar de gegevens van de viewer.

Gebruik:
    python3 tools/importeer_boomwacht.py <map-met-trees.csv>

Verwacht in die map:
    trees.csv       de export van Boomwacht
    images/         de foto's waarnaar trees.csv verwijst
    beds.csv        (optioneel) de omtrek en overige soorten van de struwelen

Schrijft:
    data/bomen.geojson
    data/foto/<boom-id>-<n>.jpg          foto op webformaat, zonder metadata
    data/foto/<boom-id>-<n>-klein.jpg    miniatuur voor de fotostrook

De soortnamen komen uit data/soorten.json. Een soort uit de export wordt
herkend aan de Nederlandse naam ('namen') of aan de Latijnse naam
('wetenschappelijk' of 'aliassen'). Onbekende soorten worden gemeld en
krijgen de Nederlandse naam uit de export; voeg ze daarna toe aan
soorten.json en draai het script opnieuw.

Vereist Pillow:  pip install pillow
"""
import csv
import json
import re
import shutil
import sys
from pathlib import Path

try:
    from PIL import Image, ImageOps
except ImportError:
    sys.exit('Pillow ontbreekt. Installeer met: pip install pillow')

REPO = Path(__file__).resolve().parent.parent
SOORTEN = REPO / 'data' / 'soorten.json'
UIT_GEOJSON = REPO / 'data' / 'bomen.geojson'
UIT_FOTO = REPO / 'data' / 'foto'

FOTO_MAX = 900       # langste zijde in pixels
KLEIN_MAX = 240
KWALITEIT = 72

GEZONDHEID = {'good': 'goed', 'fair': 'matig', 'poor': 'slecht', 'critical': 'slecht', 'unknown': 'onbekend'}


def laad_soorten():
    soorten = json.loads(SOORTEN.read_text(encoding='utf-8'))
    soorten.pop('_toelichting', None)
    op_naam, op_latijn = {}, {}
    for soort, info in soorten.items():
        op_naam[soort.lower()] = soort
        for n in info.get('namen', []):
            op_naam[n.lower()] = soort
        op_latijn[info['wetenschappelijk'].lower()] = soort
        for a in info.get('aliassen', []):
            op_latijn[a.lower()] = soort
    return soorten, op_naam, op_latijn


def bepaal_soort(rij, op_naam, op_latijn, onbekend):
    naam = rij['name_nl'].strip()
    latijn = rij['species'].strip()
    soort = op_naam.get(naam.lower()) or op_latijn.get(latijn.lower())
    if not soort:
        onbekend.setdefault((naam, latijn), []).append(rij['marker'])
        soort = naam or latijn or 'Onbekende soort'
    return soort, latijn


def verwerk_foto(bron: Path, doel_basis: Path):
    im = ImageOps.exif_transpose(Image.open(bron)).convert('RGB')
    groot = im.copy()
    groot.thumbnail((FOTO_MAX, FOTO_MAX), Image.LANCZOS)
    groot.save(doel_basis.with_suffix('.jpg'), 'JPEG', quality=KWALITEIT, optimize=True, progressive=True)
    klein = im.copy()
    klein.thumbnail((KLEIN_MAX, KLEIN_MAX), Image.LANCZOS)
    klein.save(doel_basis.with_name(doel_basis.name + '-klein.jpg'), 'JPEG', quality=72, optimize=True)


def splits(tekst):
    return [d.strip() for d in tekst.split(';') if d.strip()]


def laad_struwelen(bronmap):
    """beds.csv per bed_id; leeg als de export geen struwelen heeft."""
    pad = bronmap / 'beds.csv'
    if not pad.exists():
        return {}
    return {r['bed_id'].strip(): r for r in csv.DictReader(pad.open(encoding='utf-8-sig'))}


def omtrek(wkt):
    """POLYGON((lon lat, ...)) naar een GeoJSON-ring; None zonder omtrek."""
    paren = re.findall(r'(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)', wkt or '')
    return [[float(x), float(y)] for x, y in paren] if len(paren) >= 4 else None


def struweel_props(struweel, op_naam, op_latijn):
    props = {'type': 'struweel'}
    if struweel['area_m2'].strip():
        props['oppervlakte'] = round(float(struweel['area_m2']))
    if struweel['plant_count'].strip():
        props['aantal_planten'] = int(float(struweel['plant_count']))
    # Overige soorten van een gemengd struweel; Latijnse en Nederlandse namen staan in dezelfde volgorde.
    latijn = struweel['other_species'].split(';')
    namen = struweel['other_common_names_nl'].split(';')
    ook = []
    for i in range(max(len(latijn), len(namen))):
        la = latijn[i].strip() if i < len(latijn) else ''
        nl = namen[i].strip() if i < len(namen) else ''
        naam = op_naam.get(nl.lower()) or op_latijn.get(la.lower()) or nl or la
        if naam and naam not in ook:
            ook.append(naam)
    if ook:
        props['ook'] = ook
    planten = splits(struweel['grouped_plant_ids'])
    if planten:
        props['planten'] = planten
    return props


def main(bronmap):
    bronmap = Path(bronmap)
    csv_pad = bronmap / 'trees.csv'
    if not csv_pad.exists():
        sys.exit(f'Geen trees.csv gevonden in {bronmap}')

    soorten, op_naam, op_latijn = laad_soorten()
    rijen = list(csv.DictReader(csv_pad.open(encoding='utf-8-sig')))
    struwelen = laad_struwelen(bronmap)
    print(f'{len(rijen)} bomen in {csv_pad}, waarvan {len(struwelen)} struwelen')

    if UIT_FOTO.exists():
        shutil.rmtree(UIT_FOTO)
    UIT_FOTO.mkdir(parents=True)

    onbekend = {}
    features = []
    aantal_fotos = 0
    for rij in rijen:
        soort, latijn = bepaal_soort(rij, op_naam, op_latijn, onbekend)
        boom_id = rij['tree_id'].strip()
        props = {'id': boom_id}
        # Planten die in een struweel zijn gegroepeerd hebben geen nummer; het struweel heeft er een.
        if rij['marker'].strip():
            props['nummer'] = int(rij['marker'])
        props['soort'] = soort
        geometrie = {'type': 'Point', 'coordinates': [float(rij['x']), float(rij['y'])]}
        if rij.get('kind', '').strip() == 'bed':
            struweel = struwelen.get(boom_id)
            props.update(struweel_props(struweel, op_naam, op_latijn) if struweel else {'type': 'struweel'})
            ring = omtrek(struweel['geometry_wkt']) if struweel else None
            if ring:
                geometrie = {'type': 'Polygon', 'coordinates': [ring]}
        if rij.get('bed_id', '').strip():
            props['struweel'] = rij['bed_id'].strip()

        ras = rij['variety'].strip()
        if ras:
            props['ras'] = ras
        # Latijnse naam per boom alleen bewaren als die echt afwijkt van de soort.
        if latijn and soort in soorten:
            bekend = [soorten[soort]['wetenschappelijk']] + soorten[soort].get('aliassen', [])
            if not any(b.lower().startswith(latijn.lower()) for b in bekend):
                props['wetenschappelijk'] = latijn

        props['gezondheid'] = GEZONDHEID.get(rij['health_status'].strip().lower(), 'onbekend')
        if rij['last_health_check']:
            props['inspectiedatum'] = rij['last_health_check'][:10]
        if rij['planted_date']:
            props['geplant'] = rij['planted_date'][:10]

        # Foto's: eerst de hoofdfoto, dan de rest in volgorde van de export.
        paden = []
        for p in [rij['primary_image']] + splits(rij['images']):
            if p and p not in paden:
                paden.append(p)
        fotos = []
        for n, p in enumerate(paden, 1):
            bron = bronmap / p
            if not bron.exists():
                print(f'  boom {rij["marker"]}: foto ontbreekt, overgeslagen: {p}')
                continue
            naam = f'{boom_id}-{n}'
            verwerk_foto(bron, UIT_FOTO / naam)
            fotos.append(naam + '.jpg')
            aantal_fotos += 1
        if fotos:
            props['foto'] = fotos[0]
            if len(fotos) > 1:
                props['fotos'] = fotos

        if rij['description_nl'].strip():
            props['opmerking'] = rij['description_nl'].strip()
        problemen = splits(rij['issues_nl'])
        if rij['detection_findings_nl'].strip():
            problemen.append(rij['detection_findings_nl'].strip())
        if problemen:
            props['problemen'] = problemen

        features.append({
            'type': 'Feature',
            'id': boom_id,
            'geometry': geometrie,
            'properties': props,
        })

    # De export staat al in kaartvolgorde, met gegroepeerde planten direct na hun struweel.
    datums = sorted(f['properties'].get('inspectiedatum', '') for f in features if f['properties'].get('inspectiedatum'))
    aantal_struwelen = sum(1 for f in features if f['properties'].get('type') == 'struweel')
    uit = {
        'type': 'FeatureCollection',
        'metadata': {
            'bron': 'Boomwacht-export (Geominds)',
            'inspectie': f'{datums[0]} t/m {datums[-1]}' if datums else '',
            'aantal_bomen': len(features) - aantal_struwelen,
            'aantal_struwelen': aantal_struwelen,
        },
        'features': features,
    }
    kop = {k: v for k, v in uit.items() if k != 'features'}
    regels = [json.dumps(f, ensure_ascii=False) for f in features]
    tekst = json.dumps(kop, ensure_ascii=False, indent=2)[:-2] + ',\n  "features": [\n    ' + ',\n    '.join(regels) + '\n  ]\n}\n'
    UIT_GEOJSON.write_text(tekst, encoding='utf-8')

    print(f'{len(features) - aantal_struwelen} bomen, {aantal_struwelen} struwelen en {aantal_fotos} foto\'s weggeschreven')
    if onbekend:
        print('\nNiet in soorten.json, naam uit de export gebruikt:')
        for (naam, latijn), markers in onbekend.items():
            print(f'  {naam!r} ({latijn}) bij boom {", ".join(markers)}')
        print('Voeg deze soorten toe aan data/soorten.json en draai het script opnieuw.')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
