# Moestuinplanner

Een eenvoudige, statische moestuinplanner. Je beschrijft je tuin in één tekstbestand
(`tuin.yaml`), met de hand of met de editor, en de website rekent de rest uit:

- **Plattegrond**: je bedden op schaal, per strook wat erin staat. Met "Op datum" en de schuifregelaar zie je per week wat er groeit, wat je kunt oogsten en welke stroken leeg zijn.
- **Tijdlijn**: per teelt wanneer je binnen voorzaait, wanneer het in de grond staat en wanneer je oogst.
- **Taken**: zaaien, afharden, uitplanten, uitdunnen, aanaarden, oogsten enzovoort, per maand. Je kunt taken afvinken (dat wordt alleen in je eigen browser bewaard) en de lijst als `.ics` in je agenda zetten.
- **Hoeveelheden**: per gewas het aantal planten, hoeveel zaad of plantgoed je nodig hebt, en een ruwe schatting van de opbrengst.

## Bestanden

| Bestand | Wat |
|---|---|
| `tuin.yaml` | **Jouw tuin**: afmetingen, bedden, wat waar staat. Dit pas je aan. |
| `gewassen.yaml` | Vuistregels per gewas: afstanden, zaaivensters, groeiduur, opbrengst. Aanvullen mag. |
| `index.html`, `app.js` | De planner |
| `editor.html`, `editor.js` | De editor voor `tuin.yaml` |
| `planner.js` | De rekenlogica (datums, aantallen, taken) |
| `tekening.js`, `style.css` | Plattegrond en opmaak, gedeeld door planner en editor |

## Lokaal bekijken

De pagina leest de YAML-bestanden in, en dat werkt niet als je `index.html` direct opent.
Start daarom een kleine webserver:

```sh
python3 -m http.server
```

Ga daarna naar <http://localhost:8000> (de editor staat op <http://localhost:8000/editor.html>).

Wil je zien hoe de pagina er op een andere dag uitziet? Gebruik dan
`http://localhost:8000/?vandaag=2027-05-20&modus=datum`.

## De editor

Open `editor.html` (of klik in de planner op **✏️ Bewerken**). Daar kun je:

- de tuin en bedden aanpassen met formulieren, en bedden op de plattegrond **verslepen**;
- per bed teelten toevoegen, ordenen en verwijderen. Onder **⋯** staan plantjes kopen, gespreid zaaien, nateelten en een notitie;
- direct zien wanneer je zaait, plant en oogst, hoeveel planten er in een strook passen, en welke waarschuwingen er zijn;
- in het tabblad **YAML** de tekst zelf bewerken.

Je wijzigingen worden automatisch in je browser bewaard, zodat je niets kwijtraakt.
Met **Bekijk in planner** zie je het concept in de volledige planner. Klaar? Dan zet je
het in `tuin.yaml`:

- **💾 Opslaan…** (Chrome/Edge): kies één keer `tuin.yaml` in deze map; daarna schrijft hij er direct in (ook met Ctrl/Cmd+S);
- of **⬇️ Download** of **📋 Kopieer YAML** en vervang `tuin.yaml` zelf.

Daarna committen en pushen, en de site is bijgewerkt. Let op: de editor schrijft het
bestand opnieuw uit, dus eigen commentaarregels in `tuin.yaml` verdwijnen. Alleen een
vaste uitlegkop bovenaan blijft staan.

## Publiceren op GitHub Pages

1. Push deze map naar een GitHub-repository.
2. Ga naar *Settings → Pages*, kies *Deploy from a branch*, branch `main`, map `/ (root)`.
3. Na een minuutje staat de site op `https://<gebruiker>.github.io/<repo>/`.

Elke keer dat je `tuin.yaml` aanpast en pusht, wordt de site vanzelf bijgewerkt.

## Zo werkt `tuin.yaml`

```yaml
bedden:
  - naam: Bed 2
    positie: [2.0, 0.4]   # linkerbovenhoek in meter
    maat: [1.2, 4.0]      # breedte × hoogte in meter
    teelt:
      - gewas: aardappel
        deel: 2.5          # strook van 2,5 m (weglaten = rest van het bed)
        daarna: [andijvie] # nateelt in dezelfde strook, gepland zodra de aardappels eruit zijn
      - { gewas: tomaat, plantgoed: true }   # plantjes kopen in plaats van zelf zaaien
      - { gewas: kropsla, herhaal: 3, elke: 3 }  # drie zaaiingen, steeds 3 weken later
```

Zonder `datum` plant de site alles aan het begin van het gebruikelijke zaaivenster. Bij
een nateelt is dat zo vroeg mogelijk nadat de vorige teelt klaar is. Met `datum: 04-15`,
`datum: 2027-04-15` of `datum: week 15` kies je zelf een datum. Valt een datum buiten het
venster, of overlappen teelten of bedden, dan zie je bovenaan een waarschuwing.

Vaste planten zoals aardbei, framboos en ribes (`vast: true` in `gewassen.yaml`) staan er
het hele jaar. Je krijgt elk jaar hun oogstperiode en onderhoudsklussen (snoeien, net
ertegen). Geef je ze een `datum`, dan plant de site ze op die dag.

De bedden zijn ingekleurd per plantenfamilie. Zo zie je in één oogopslag hoe de
vruchtwisseling loopt. Schuif volgend jaar de families één bed op.

De waarden in `gewassen.yaml` zijn vuistregels voor Nederland. Pas ze aan op je eigen
rassen en ervaring.
