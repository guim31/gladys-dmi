# DMI

Das offizielle Wetter des **Dänischen Meteorologischen Instituts (DMI)** in
Gladys: die Messungen der nächsten DMI-Wetterstation und die
HARMONIE-Vorhersage des DMI für deinen Ort, in Dänemark, Grönland und auf den
Färöern. Offene Daten des DMI: ohne Konto und ohne API-Schlüssel.

> Nicht mit DMI verbunden. Gegen die echte DMI-API getestet, noch nicht in
> einer echten Gladys-Installation: Rückmeldungen im Gladys-Forum sind
> willkommen.

## Was die Integration macht

- **Ein Vorhersagegerät pro Ort**: jedes Haus mit Standort in Gladys und
  optional ein Ort über seine Koordinaten (Sommerhaus, Boot…). Es liefert die
  Vorhersage der laufenden Stunde (Temperatur, Luftfeuchtigkeit, Luftdruck,
  Wind, Böen, Richtung, Bewölkung, Niederschlag, Wetter in Worten) sowie
  Tiefst-, Höchstwert und Niederschlag von heute und morgen.
- **Ein Gerät pro genutzter DMI-Station**: die Messungen der nächsten
  Station, die Temperatur und Wind misst, alle 10 Minuten: Temperatur,
  Luftfeuchtigkeit, Luftdruck auf Meereshöhe, Wind, Böen, Richtung,
  Niederschlag der letzten Stunde, Sichtweite, Bewölkung. Nur was die Station
  misst, wird angezeigt.
- Ein **Szenen-Auslöser**, wenn die Vorhersage Frost, Sturmböen oder
  Starkregen in den nächsten 24 Stunden ankündigt.
- Zwei **Szenenaktionen**: einen Tag der Vorhersage lesen, die Station lesen.
- Ein **Dashboard-Widget**: gemessenes Wetter, nächste 24 Stunden, kommende
  Tage.

Unterschied zu den anderen Wetter-Integrationen: **MET Norway** liefert eine
weltweite Vorhersage ohne Messungen, **MeteoAlarm** die amtlichen Warnungen
(auch die des DMI). Diese hier liefert die **Messungen der DMI-Stationen** und
das **DMI-Modell**, das genaueste für Dänemark.

## Voraussetzungen

- Gladys Assistant 5.3.0 oder neuer.
- Gladys muss `opendataapi.dmi.dk` per HTTPS erreichen.
- Für die Häuser: ein Standort unter **Einstellungen → Häuser** in Gladys.

## Installation

1. Öffne in Gladys **Integrationen → Von GitHub installieren** und gib
   `https://github.com/guim31/gladys-dmi` ein, oder installiere **DMI** aus
   dem Store.
2. Öffne den Reiter **Konfiguration**, prüf die Einstellungen und speichere.
3. Öffne den Reiter **Entdeckung** und füg die gewünschten Geräte hinzu: ein
   Vorhersagegerät pro Ort, ein Gerät pro Station.

## Konfiguration

- **Häuser in Gladys verfolgen**: ein Ort pro Haus mit Standort.
- **Anderer Ort**: Breitengrad, Längengrad (Dezimalgrad, ein Komma geht
  auch) und Name. Leer lassen für nur die Häuser.
- **DMI-Station**: leer für die nächste Station, die Temperatur und Wind
  misst; oder die Kennung einer DMI-Station, fünf Ziffern (`06180` für den
  Flughafen Kopenhagen). Die Kennungen stehen auf den Open-Data-Seiten des
  DMI.
- **Nächste Station im Umkreis von**: 25, 50 oder 100 km. Weiter entfernt
  hat der Ort nur die Vorhersage (etwa ein Ort außerhalb Dänemarks).
- **Aktualisierungsintervall**: standardmäßig 10 Minuten, so oft wie DMI
  misst.
- **Sprache der Namen und Texte**: Funktionsnamen neuer Geräte, Wetter in
  Worten, Sätze der Szenenaktionen. Standardmäßig Französisch.

## Die Geräte

Das **Vorhersagegerät** eines Orts enthält: Temperatur, Luftfeuchtigkeit,
Luftdruck, Windgeschwindigkeit, Böen, Windrichtung, Bewölkung, Niederschlag
der Stunde (mm), das Wetter in Worten (klar, teilweise bewölkt, bewölkt,
leichter Regen, Regen, Schnee), Tiefst-, Höchstwert und Niederschlag von
heute (die verbleibenden Stunden) und morgen.

Das **Stationsgerät** enthält, was die Station misst, aus: Temperatur,
Luftfeuchtigkeit, Luftdruck auf Meereshöhe, Windgeschwindigkeit, Böen
(stärkster 3-Sekunden-Wind der letzten 10 Minuten), Richtung, Niederschlag
der letzten Stunde, Sichtweite und Bewölkung. Ein Wert, der älter als
3 Stunden ist, wird nicht veröffentlicht (Station ausgefallen). Jede Funktion
kann eine Gladys-Szene auslösen („Temperatur unter 0 °C“).

## Dashboard-Widget

Das Widget **DMI-Wetter** zeigt für einen Ort: das Wetter in Worten, die
Station und die Uhrzeit ihrer Messung, gemessene Temperatur, Wind und
Luftfeuchtigkeit (die Vorhersage, wenn keine Station in der Nähe ist), eine
24-Stunden-Temperaturkurve und die nächsten drei Tage. Einstellungen: der Ort
(oder eine Station: nur ihre Messungen), Kurve anzeigen, kommende Tage
anzeigen.

## Szenen-Auslöser: DMI-Vorhersagealarm

Ausgelöst, wenn die Vorhersage eines Orts in den nächsten 24 Stunden
ankündigt:

- **Frost**: eine Temperatur unter 0 °C;
- **Sturmböen**: Böen ab 24,5 m/s;
- **Starkregen**: 24 mm oder mehr in 6 Stunden.

Jeder Alarm kommt einmal pro Art und Tag, auch nach einem Neustart nicht
erneut. Filter: Ort und Art. Variablen: `kind` (`frost`, `storm`,
`heavy_rain`), `value` (tiefste Temperatur in °C, stärkste Böe in m/s oder
größte 6-Stunden-Summe in mm) und `starts_at`.

## Szenenaktionen

- **DMI-Vorhersage lesen**: für einen Ort und einen Tag (heute, morgen,
  übermorgen) Tiefst- und Höchstwert, Niederschlag, stärkste Böe, Wetter und
  ein Satz wie „Morgen in DMI Zuhause: Leichter Regen, 3 bis 7 °C, 2.1 mm
  Niederschlag, Böen bis 14 m/s.“ Schlägt fehl, wenn die Vorhersage den Tag
  nicht ausreichend abdeckt.
- **DMI-Station lesen**: für einen Ort oder eine Station Temperatur,
  Luftfeuchtigkeit, Wind, Böe, Niederschlag der letzten Stunde, Name der
  Station und Uhrzeit der Messung. Schlägt ohne aktuelle Messung fehl.

## Konfigurationsaktion: DMI prüfen

**DMI prüfen** liest für jeden Ort (hinzugefügt oder nicht) seine Station und
seine Vorhersage und zeigt die Antwort. Rot, wenn DMI nicht antwortet.

## Aktualisierung und Kontingente

DMI veröffentlicht kein Kontingent für seine offenen Daten ohne Schlüssel,
lehnt aber gebündelte Anfragen ab. Die Integration sendet eine Anfrage nach
der anderen, im Abstand von einer Sekunde, und versucht es nach einer Pause
erneut. Pro Aktualisierung: eine Anfrage pro hinzugefügter Station; die
Vorhersage eines hinzugefügten Orts höchstens einmal pro Stunde (das Modell
läuft alle drei Stunden); die Stationsliste einmal am Tag. Nur die
hinzugefügten Geräte werden gelesen.

## Fehlerbehebung

- **„Kein Ort“**: Gib einem Haus in Gladys einen Standort oder trag
  Koordinaten ein.
- **„Außerhalb des DMI-Vorhersagegebiets“**: Die DMI-Modelle decken
  Dänemark, die Färöer, Island, die Nordsee und Grönland ab.
- **Kein Stationsgerät**: keine DMI-Station im gewählten Umkreis; vergrößere
  ihn oder trag eine Stationskennung ein.
- **„Diese DMI-Station ist unbekannt“**: falsche Kennung oder Station
  ausgefallen; lass das Feld leer.
- Setz `LOG_LEVEL=debug` für die Details jeder Anfrage.

## Grenzen

- Das Wetter in Worten wird aus Bewölkung, Niederschlag und Temperatur
  abgeleitet: HARMONIE liefert kein Wettersymbol.
- Die Vorhersage reicht etwa 60 Stunden (72 in Grönland): Übermorgen ist oft
  unvollständig.
- Die DMI-Warnungen gehören nicht zu den offenen Daten: nimm MeteoAlarm.

## Danksagung und Lizenz

Daten: **Dänisches Meteorologisches Institut (DMI)**, offene Daten unter der
Lizenz
[Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/).
Integration: Apache-2.0, von guim31.
