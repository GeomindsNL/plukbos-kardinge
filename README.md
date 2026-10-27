# Plukbos Kardinge, kaartviewer

Open-source kaartviewer voor de bomen in het plukbos bij Kardinge in Groningen. De kaart laat zien waar elke boom staat, wanneer hij vrucht draagt en hoe gezond hij is. De bomen zijn geïnspecteerd met [Boomwacht](https://www.geominds.nl/nl/products/boomwacht/), de boominspectie-app van [Geominds](https://www.geominds.nl/nl/).

De viewer is een statische website: HTML, CSS, JavaScript en twee JSON-bestanden. Er is geen database, geen build-stap en geen servercode. Elke webserver die bestanden kan serveren, kan hem hosten.

## Structuur

```
index.html              de pagina
css/viewer.css          opmaak
js/viewer.js            kaart en bediening; bovenin staat het blok INSTELLINGEN
data/bomen.geojson      de bomen uit de inspectie, één punt per boom
data/soorten.json       oogstperiode, Latijnse naam en naamvarianten per soort
data/foto/              foto's en miniaturen per boom
tools/                  importscript voor een Boomwacht-export
lib/leaflet/            Leaflet 1.9.4, lokaal meegeleverd
fonts/                  Atkinson Hyperlegible en Newsreader, lokaal meegeleverd
img/                    Geominds-logo en merkteken
LICENSE                 EUPL-1.2, voor de code
LICENSE-DATA            CC BY 4.0, voor alles in data/
NOTICE                  naamsvermelding en onderdelen van derden
```

Alles draait vanaf de eigen server. Alleen de ondergrond (luchtfoto en kaart) komt live van PDOK, de publieke kaartdienst van de Nederlandse overheid.

## Lokaal bekijken

Browsers laden de gegevens niet als je `index.html` dubbelklikt. Start daarom een eenvoudige webserver in deze map:

```
python3 -m http.server
```

en open `http://localhost:8000`. Op Windows heet Python meestal `py`:

```
py -m http.server --bind 127.0.0.1
```

## Hosten

Kopieer de hele map naar een webserver, bijvoorbeeld als submap van een bestaande website. Codeberg Pages of GitHub Pages werken ook: zet de repository daar neer en zet Pages aan.

Zet in `js/viewer.js` bij `broncodeUrl` het adres van de repository. Dan verschijnt in het venster "Over deze kaart" een link naar de broncode.

## Gegevens bijwerken

De bomen zijn ingemeten met Boomwacht. Na een nieuwe inspectie exporteer je daaruit een map met `trees.csv`, `beds.csv` en een map `images/`, en zet je die om met het importscript:

```
pip install pillow
python3 tools/importeer_boomwacht.py <map-met-trees.csv>
```

Het script schrijft `data/bomen.geojson` en vult `data/foto/` opnieuw met foto's op webformaat (900 pixels, zonder metadata) en miniaturen voor de fotostrook. Soorten die het script niet kent, meldt het aan het eind; voeg die toe aan `data/soorten.json` en draai het nog een keer. Daarna: versie in `index.html` ophogen (zie verderop), committen en pushen.

### Bomen: `data/bomen.geojson`

Een standaard GeoJSON FeatureCollection in WGS84 (lengtegraad, breedtegraad): een punt per boom en een vlak (`Polygon`) per struweel. Opent direct in QGIS en op geojson.io. Het importscript maakt dit bestand, maar het is ook met de hand te bewerken.

| Veld | Verplicht | Inhoud |
|---|---|---|
| `id` | ja | het id van de boom uit Boomwacht, bijvoorbeeld `LA2M1O9Q`; blijft gelijk tussen exports |
| `nummer` | nee | boomnummer uit de export; staat op het kaartje en in de lijst, en `#12` opent boom 12 |
| `soort` | ja | Nederlandse soortnaam, gelijk aan een sleutel in `soorten.json` |
| `ras` | nee | rasnaam, bijvoorbeeld `Granny Smith` |
| `gezondheid` | ja | `goed`, `matig` of `slecht`; iets anders wordt `onbekend` |
| `inspectiedatum` | nee | datum als `JJJJ-MM-DD` |
| `geplant` | nee | plantdatum als `JJJJ-MM-DD` |
| `foto` | nee | hoofdfoto: bestandsnaam in `data/foto/`, of een volledige URL |
| `fotos` | nee | alle foto's van de boom, hoofdfoto eerst; bij meer dan één verschijnt een fotostrook |
| `opmerking` | nee | vrije tekst, verschijnt op het kaartje van de boom |
| `problemen` | nee | lijst met aandachtspunten, bijvoorbeeld `["Appelschurft", "Stamscheur"]` |
| `oogst_van`, `oogst_tot` | nee | maandnummers 1 tot en met 12; overschrijven de periode uit `soorten.json` voor deze ene boom |
| `wetenschappelijk` | nee | Latijnse naam; overschrijft die uit `soorten.json` |

Een struweel is een groep planten die als geheel is vastgelegd en geïnspecteerd, zoals een gemengde haag. Het heeft dezelfde velden als een boom, plus:

| Veld | Verplicht | Inhoud |
|---|---|---|
| `type` | ja | `struweel` |
| `oppervlakte` | nee | oppervlakte van de omtrek in m² |
| `aantal_planten` | nee | aantal planten zoals ingevoerd in Boomwacht |
| `ook` | nee | de overige soorten van een gemengd struweel, bijvoorbeeld `["Appel"]` |
| `planten` | nee | ids van de planten die apart zijn vastgelegd en in het struweel gegroepeerd |

Zo'n gegroepeerde plant staat als eigen punt in het bestand, zonder `nummer` en met `struweel` (het id van het struweel). De kaart tekent een struweel met gegroepeerde planten donker goud en een struweel zonder appelgroen; de kleuren staan als `--struweel-gegroepeerd` en `--struweel-los` in `css/viewer.css`.

Bij elke foto `naam.jpg` hoort een miniatuur `naam-klein.jpg`. Ontbreekt die, dan gebruikt de viewer de foto zelf.

Staat bovenin het bestand `"metadata": { "voorbeeld": true }`, dan toont de viewer de melding "Voorbeeldgegevens".

### Oogstperiodes en soortnamen: `data/soorten.json`

De inspectie legt de oogstperiode niet vast; die hoort bij de soort en het ras. Daarom staat hij in een eigen bestand, dat bij een nieuwe inspectie gewoon blijft staan. Hetzelfde bestand vertelt het importscript welke namen uit de export bij welke soort horen.

```json
"Appel": {
  "wetenschappelijk": "Malus domestica",
  "aliassen": ["Malus Domestica"],
  "namen": ["Appelboom", "Eetappel"],
  "oogst": { "van": 8, "tot": 10 },
  "rassen": {
    "Granny Smith": { "oogst": { "van": 10, "tot": 11 } }
  }
}
```

- `wetenschappelijk` en `aliassen`: Latijnse schrijfwijzen waaraan het importscript de soort herkent.
- `namen`: Nederlandse namen uit de export die naar deze soort verwijzen. De sleutel zelf telt ook mee.
- `oogst`: de periode voor de soort; `rassen` kan daar per ras van afwijken. Een periode mag over de jaarwisseling lopen, bijvoorbeeld `{ "van": 11, "tot": 1 }`.
- `"eetbaar": false`: voor bomen en struiken waar niets te plukken valt, zoals de es en de zomereik. De viewer toont dan "Niet om te plukken".

De viewer zoekt eerst de periode van het ras, dan die van de soort. Staat er geen periode en is de soort eetbaar, dan toont hij "Oogstperiode onbekend".

### Foto's: `data/foto/`

Het importscript maakt de foto's kleiner en haalt de metadata (tijdstip, toestel, soms GPS) eruit. Voeg je met de hand een foto toe, doe dan hetzelfde, bijvoorbeeld met ImageMagick:

```
mogrify -resize '900x900>' -strip -quality 72 data/foto/naam.jpg
convert data/foto/naam.jpg -resize '240x240>' -strip -quality 72 data/foto/naam-klein.jpg
```

Alle foto's samen zijn nu ruim 60 MB. Dat past ruim op GitHub Pages en op een gewone webserver. Komen er over de jaren veel inspecties bij, dan kunnen de foto's buiten de repository gezet worden; de velden `foto` en `fotos` accepteren ook volledige URL's.

### Posities controleren

Telefoon-GPS zit onder bladerdek al snel een paar meter naast de boom. Controleer de posities na een inspectie in QGIS: laad `bomen.geojson` samen met de PDOK-luchtfoto (Actueel_orthoHR) en schuif punten die bij de buurboom zijn beland naar de juiste kruin. Sla op als GeoJSON in WGS84.

## Instellingen

Bovenin `js/viewer.js` staat het blok `INSTELLINGEN` met:

- de paden naar de gegevens en foto's
- de links naar Geominds en naar de productpagina, en de productnaam
- de link naar de broncode
- het startpunt van de kaart en het zoomniveau bij het openen van een boom

Meer hoeft er normaal niet aangepast te worden.

## Wijzigingen in de code doorvoeren

Browsers bewaren `css/viewer.css` en `js/viewer.js` in hun cache. In `index.html` staat daarom een versie achter beide bestanden, bijvoorbeeld `viewer.js?v=2026-09-20`. Zet daar na elke wijziging in `css/` of `js/` een nieuwe datum neer; dan halen bezoekers de nieuwe versie op.

De gegevens in `data/` worden altijd vers geladen. Daarvoor hoeft niets aangepast te worden.

Zie je zelf na een wijziging nog de oude versie, druk dan op Ctrl+F5 (Cmd+Shift+R op een Mac).

## Licenties en naamsvermelding

De code valt onder de [EUPL-1.2](LICENSE). De gegevens en foto's in `data/` vallen onder [CC BY 4.0](LICENSE-DATA). Wie de gegevens hergebruikt, vermeldt daarbij: **Inventarisatie: Geominds (https://www.geominds.nl)**.

De viewer toont Geominds op drie plekken: als "Powered by Geominds" in de voet van het paneel, onderaan elk boomkaartje en in het venster "Over deze kaart".

Het Geominds-logo en het merkteken in `img/` vallen niet onder de EUPL. Ze mogen alleen gebruikt worden om naar Geominds te verwijzen.

Meegeleverde onderdelen van derden staan in [NOTICE](NOTICE): Leaflet (BSD-2-Clause) en de lettertypen Atkinson Hyperlegible en Newsreader (SIL Open Font License 1.1).
