# IoBroker.Maxxi-Charge

**ioBroker.MaxxiSun** ist ein Adapter für das ioBroker-System, der die Integration und Steuerung von MaxxiCharge CCU-Geräten ermöglicht. Der Adapter erlaubt das Lesen von Gerätedaten, die Anpassung von Konfigurationen und das Senden von Steuerbefehlen.

## Funktionen

- **Datenabfrage**: 
  - Liest Informationen wie IP-Adresse, Status oder Leistung der CCU.
  - Automatische Erstellung dynamischer Datenpunkte für Gerätedaten.
- **Konfiguration**:
  - Anpassung von Parametern wie maximaler Ausgangsleistung, Schwellenwerten oder Ladeverhalten.
- **Steuerbefehle**:
  - Dynamische Datenpunkte (`<deviceId>.sendcommand`) zum Senden von Befehlen an die CCU.
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
   - API Modus auswählen 
   - Bei auswahl Local-API in der CCU unter Api-Route eintragen: http://"IP":"PORT" eingeben

## Konfigurationsmöglichkeiten

| Einstellung              | Beschreibung                                     |
|--------------------------|-------------------------------------------------|
| **Maxxi CCU Name**       | Name oder IP-Adresse der Maxxi CCU.             |
| **Aktualisierungsintervall** | Zeit in Minuten zwischen den Datenabfragen.   |

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

- Fehler beim Verarbeiten der Daten: deviceId nicht vorhanden ->> Restart Adapter nachdem CCU info eingegeben wurde.

## Changelog

### 1.2.191 (2025-12-08)

* Veröffentlichung

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


