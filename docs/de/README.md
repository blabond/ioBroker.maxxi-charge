# ioBroker.Maxxi-Charge

**ioBroker.MaxxiCharge** ist ein Adapter für das ioBroker-System, der die Integration und Steuerung von MaxxiCharge CCU-Geräten ermöglicht. Der Adapter bietet eine Vielzahl von Funktionen, darunter das Lesen von Gerätedaten, die Anpassung von Konfigurationen und das Senden von Steuerbefehlen.

## Funktionen

- **Datenabfrage**:
    - Liest Informationen wie IP-Adresse, Status oder Leistung der CCU.
    - Automatische Erstellung dynamischer Datenpunkte für Gerätedaten.
- **Konfiguration**:
    - Anpassung von Parametern wie maximaler Ausgangsleistung, Schwellenwerten oder Ladeverhalten.
    - **Sommer/Winter-Betrieb**: Dynamische Anpassung der Ladeparameter basierend auf der Jahreszeit.
    - **Batteriekalibrierung**: Unterstützt einen automatisierten Kalibrierungsprozess für die Batterie.
    - **Einspeisungssteuerung**: Konfiguration der maximalen Ladung zur Aktivierung oder Deaktivierung der Einspeisung.
- **Steuerbefehle**:
    - Dynamische Datenpunkte (`<deviceId>.sendcommand`) zum Senden von Befehlen an die CCU.
- **Flexibles Abfrageintervall (Cloud-Modus)**:
    - Der Nutzer kann das Abfrageintervall der CCU-Daten zwischen 5 und 90 Sekunden anpassen.
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
    - API-Modus auswählen (Cloud oder Local).
    - Bei Auswahl der Local-API in der CCU unter `Api-Route` folgendes eintragen: `http://"IP":"PORT"`.
2. **Wichtiger Hinweis beim Update**:
    - Löschen Sie den Ordner `.sendcommand` und starten Sie den Adapter neu, wenn Sie von einer früheren Version aktualisieren. (< 1.4.0)

## Konfigurationsmöglichkeiten

| Einstellung                  | Beschreibung                                                                     |
|------------------------------|----------------------------------------------------------------------------------|
| **Maxxi CCU Name**           | Name oder IP-Adresse der Maxxi CCU.                                              |
| **CCU Abfrageintervall**     | Intervall (10-90 Sekunden) für die Abfrage der CCU-Daten im Cloud-Modus.         |
| **Sommer/Winter-Betrieb**    | Automatische Anpassung der Ladeparameter basierend auf definierten Winter-Daten. |
| **Port für Local-API**       | Definiert den Port, auf dem die Local-API lauscht.                               |
| **Einspeisungssteuerung**    | Konfiguration zur Aktivierung oder Deaktivierung der Einspeisung.                |
| **Batteriekalibrierung**     | Startet den automatisierten Kalibrierungsprozess für die Batterie.               |

## Sommer / Winter-Betrieb

Der Sommer/Winter-Betrieb bietet eine dynamische Anpassung der Ladeparameter:

- **Wintermodus**:
    - Mindestladung wird morgens um 8 Uhr auf 60% gesetzt.
    - Falls der SOC (State of Charge) ≥ 55% beträgt, wird die Mindestladung auf 40% reduziert.
- **Sommermodus**:
    - Mindestladung wird auf 10% gesetzt.
    - Maximale Ladung wird auf 97% begrenzt.
- Die Aktivierung erfolgt durch eine Checkbox in den Adapter-Einstellungen, die Zeiträume werden durch Winter-Start- und -Enddatum festgelegt.

## Batteriekalibrierung

Die Batteriekalibrierung umfasst einen automatisierten Prozess:

1. **Start**:
    - Der Adapter senkt die `minSOC`-Einstellung auf 1%, um die Batterie zu entladen.
2. **Aufladen**:
    - Nach Erreichen von <1% SOC wird die `minSOC`-Einstellung auf 99% erhöht.
3. **Abschluss**:
    - Nach Erreichen von 99% SOC wechselt der Adapter zurück in den Regelbetrieb.

Die Kalibrierung kann in den Experteneinstellungen aktiviert werden.

## Einspeisungssteuerung

Die Einspeisungssteuerung ermöglicht es, die maximale Ladung (`maxSOC`) so zu konfigurieren, dass überschüssiger Strom ins Netz eingespeist wird oder nicht:

- **97% (Einspeisung aktiv)**:
    - Überschüssiger Strom wird ins Netz eingespeist, wenn die Batterie mehr als 97% SOC hat.
- **100% (Einspeisung deaktiviert)**:
    - Es wird kein überschüssiger Strom ins Netz eingespeist.

## Datenpunkte

Der Adapter erstellt dynamisch Datenpunkte basierend auf den von der CCU zurückgegebenen Informationen:

| Datenpunkt                 | Beschreibung                     |
|----------------------------|----------------------------------|
| `<deviceId>.SOC`           | Batterie Ladezustand.            |
| `<deviceId>.settings.*`    | Gerätespezifische Einstellungen. |
| `<deviceId>.sendcommand.*` | Steuerbefehle für die CCU.       |

## Hinweise

- Änderungen an Datenpunkten im Bereich `<deviceId>.sendcommand` werden automatisch erkannt und an die CCU gesendet.
- Bei Problemen mit fehlenden Datenpunkten oder unerwartetem Verhalten: Adapter neu starten.

## Fehler

- **Fehler beim Verarbeiten der Daten**:
    - `deviceId` nicht vorhanden → Adapter neu starten, nachdem die CCU-Info eingegeben wurde.
