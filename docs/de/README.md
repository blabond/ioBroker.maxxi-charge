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
  - Der Nutzer kann das Abfrageintervall der CCU-Daten zwischen 10 und 90 Sekunden anpassen.
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

| Einstellung                 | Beschreibung                                                                     |
|-----------------------------|----------------------------------------------------------------------------------|
| **Maxxi CCU Name**          | Name oder IP-Adresse der Maxxi CCU.                                              |
| **CCU Abfrageintervall**    | Intervall (10-90 Sekunden) für die Abfrage der CCU-Daten im Cloud-Modus.         |
| **Sommer/Winter-Betrieb**   | Automatische Anpassung der Ladeparameter basierend auf definierten Winter-Daten. |
| **Port für Local-API**      | Definiert den Port, auf dem die Local-API lauscht.                               |

## Sommer / Winter-Betrieb

Der Sommer/Winter-Betrieb bietet eine dynamische Anpassung der Ladeparameter:

- **Wintermodus**: 
  - Mindestladung wird morgens um 8 Uhr auf 60% gesetzt.
  - Falls der SOC (State of Charge) ≥ 55% beträgt, wird die Mindestladung auf 40% reduziert.
- **Sommermodus**:
  - Mindestladung wird auf 10% gesetzt.
  - Maximale Ladung wird auf 97% begrenzt.
- Die Aktivierung erfolgt durch eine Checkbox in den Adapter-Einstellungen, die Zeiträume werden durch Winter-Start- und -Enddatum festgelegt.

## Datenpunkte

Der Adapter erstellt dynamisch Datenpunkte basierend auf den von der CCU zurückgegebenen Informationen:

### Beispiele für Datenpunkte:

| Datenpunkt                 | Beschreibung                     |
|----------------------------|----------------------------------|
| `<deviceId>.SOC`           | Batterie Ladezustand.            |
| `<deviceId>.settings.*`    | Gerätespezifische Einstellungen. |
| `<deviceId>.sendcommand.*` | Steuerbefehle für die CCU.       |

## Hinweise

- Änderungen an Datenpunkten im Bereich `<deviceId>.sendcommand` werden automatisch erkannt und an die CCU gesendet.

## Fehler

- Fehler beim Verarbeiten der Daten: deviceId nicht vorhanden ->> Restart Adapter, nachdem CCU-Info eingegeben wurde.