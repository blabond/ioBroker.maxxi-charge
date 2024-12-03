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

 **Adapter konfigurieren**:
   - Den Namen der CCU (`Maxxi CCU Name`) eintragen.
   - Aktualisierungsintervall in Minuten festlegen.

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
