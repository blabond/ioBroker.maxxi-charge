# IoBroker.Maxxi-Charge

**ioBroker.MaxxiCharge** ist ein Adapter für das ioBroker-System, der die Integration und Steuerung von MaxxiCharge CCU-Geräten ermöglicht. Der Adapter erlaubt das Lesen von Gerätedaten, die Anpassung von Konfigurationen und das Senden von Steuerbefehlen.

## Funktionen

- **Datenabfrage**: 
  - Liest Informationen wie IP-Adresse, Status oder Leistung der CCU.
  - Automatische Erstellung dynamischer Datenpunkte für Gerätedaten.
- **Konfiguration**:
  - Anpassung von Parametern wie maximaler Ausgangsleistung, Schwellenwerten oder Ladeverhalten.
  - **Sommer/Winter-Betrieb**: Dynamische Anpassung der Ladeparameter basierend auf der Jahreszeit.
- **Steuerbefehle**:
  - Dynamische Datenpunkte (`<deviceId>.sendcommand`) zum Senden von Befehlen an die CCU.
- **Flexibles Abfrageintervall (Cloud-Modus)**:
  - Der Nutzer kann das Abfrageintervall der CCU-Daten zwischen 10 und 60 Sekunden anpassen.
- **Fehlerhandling**:
  - Dokumentation von Fehlern und Bereitstellung von Fallback-Mechanismen.

## Anforderungen

| Komponente                  | Beschreibung                                              |
|-----------------------------|----------------------------------------------------------|
| **MaxxiCharge CCU**         | Unterstütztes Gerät mit Netzwerkverbindung.              |
| **ioBroker**                | Installierte ioBroker-Instanz.                           |
| **Node.js**                 | Aktuelle Version von Node.js (siehe ioBroker-Anforderungen). |

## Installation

1. **Adapter konfigurieren**:
   - Den Namen der CCU (`Maxxi CCU Name`) eintragen.
   - API Modus auswählen (Cloud oder Local).
   - Bei Auswahl Local-API in der CCU unter `Api-Route` folgendes eintragen: `http://"IP":"PORT"`.

## Konfigurationsmöglichkeiten

| Einstellung                 | Beschreibung                                             |
|-----------------------------|---------------------------------------------------------|
| **Maxxi CCU Name**          | Name oder IP-Adresse der Maxxi CCU.                     |
| **CCU Abfrageintervall**    | Intervall (10-60 Sekunden) für die Abfrage der CCU-Daten im Cloud-Modus. |
| **Sommer/Winter-Betrieb**   | Automatische Anpassung der Ladeparameter basierend auf definierten Winter-Daten. |
| **Port für Local-API**      | Definiert den Port, auf dem die Local-API lauscht.       |

## Sommer / Winter-Betrieb

Der Sommer/Winter-Betrieb bietet eine dynamische Anpassung der Ladeparameter:

- **Wintermodus**: 
  - Mindestladung wird morgens um 8 Uhr auf 70% gesetzt.
  - Falls der SOC (State of Charge) ≥ 55% beträgt, wird die Mindestladung auf 40% reduziert.
- **Sommermodus**:
  - Mindestladung wird auf 10% gesetzt.
  - Maximale Ladung wird auf 97% begrenzt.
- Die Aktivierung erfolgt durch eine Checkbox in den Adapter-Einstellungen, die Zeiträume werden durch Winter-Start- und -Enddatum festgelegt.

## Datenpunkte

Der Adapter erstellt dynamisch Datenpunkte basierend auf den von der CCU zurückgegebenen Informationen:

### Beispiele für Datenpunkte:

| Datenpunkt                      | Beschreibung                                |
|---------------------------------|--------------------------------------------|
| `<deviceId>.systeminfo.ip_addr` | IP-Adresse der CCU.                        |
| `<deviceId>.settings.*`         | Gerätespezifische Einstellungen.           |
| `<deviceId>.sendcommand.*`      | Steuerbefehle für die CCU.                 |

## Hinweise

- Änderungen an Datenpunkten im Bereich `<deviceId>.sendcommand` werden automatisch erkannt und an die CCU gesendet.

## Fehler

- Fehler beim Verarbeiten der Daten: deviceId nicht vorhanden ->> Restart Adapter, nachdem CCU-Info eingegeben wurde.

## Changelog

### 1.3.0 (2024-12-15)
- **Sommer/Winter-Betrieb** hinzugefügt:
  - Dynamische Anpassung der Ladeparameter basierend auf Jahreszeiten.
  - Konfigurierbar mit Start- und Enddatum.
- **Cloud-API Abfrageintervall**: Intervall für CCU-Abfragen im Cloud-Modus ist nun über einen Schieberegler zwischen 10 und 60 Sekunden einstellbar.

### 1.2.191 (2024-12-08)
- Veröffentlichung

## License
MIT License

Copyright (c) 2024

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
