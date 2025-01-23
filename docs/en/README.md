# ioBroker.Maxxi-Charge

**ioBroker.MaxxiCharge** is an adapter for the ioBroker system that enables the integration and control of MaxxiCharge CCU devices. The adapter provides a range of features, including reading device data, adjusting configurations, and sending control commands.

## Features

- **Data Query**:
    - Reads information such as IP address, status, or performance of the CCU.
    - Automatically creates dynamic datapoints for device data.
- **Configuration**:
    - Adjusts parameters such as maximum output power, thresholds, or charging behavior.
    - **Summer/Winter Mode**: Dynamically adjusts charging parameters based on the season.
    - **Battery Calibration**: Supports an automated calibration process for the battery.
    - **Feed-in Control**: Configures maximum charge to enable or disable energy feed-in to the grid.
- **Control Commands**:
    - Dynamic datapoints (`<deviceId>.sendcommand`) for sending commands to the CCU.
- **Flexible Query Interval (Cloud Mode)**:
    - Users can adjust the CCU data query interval between 5 and 90 seconds.

## Requirements

| Component                | Description                                             |
|--------------------------|---------------------------------------------------------|
| **MaxxiCharge CCU**      | Supported device with network connection.               |
| **ioBroker**             | Installed ioBroker instance.                            |
| **Node.js**              | Current version of Node.js (see ioBroker requirements). |

## Installation

1. **Configure the Adapter**:
    - Enter the name of the CCU (`maxxi-XXXXXX-YYY`).
    - Select API Mode (Cloud or Local).
    - If using Local-API, enter the following under `Api-Route` in the CCU: `http://"IP":"PORT"`.
2. **Important Update Note**:
    - Delete the `.sendcommand` folder and restart the adapter if updating from an older version. (< 1.4.0)

## Configuration Options

| Setting                   | Description                                                              |
|---------------------------|--------------------------------------------------------------------------|
| **Maxxi CCU Name**        | Name or IP address of the Maxxi CCU.                                     |
| **CCU Query Interval**    | Interval (10-90 seconds) for querying CCU data in Cloud Mode.            |
| **Summer/Winter Mode**    | Automatically adjusts charging parameters based on defined winter dates. |
| **Port for Local-API**    | Defines the port on which the Local-API listens.                         |
| **Feed-in Control**       | Configures whether excess energy is fed into the grid.                   |
| **Battery Calibration**   | Starts the automated calibration process for the battery.                |

## Summer / Winter Mode

The Summer/Winter Mode dynamically adjusts the charging parameters:

- **Winter Mode**:
    - Minimum charge is set to 60% every day at 8:00 AM.
    - If the SOC (State of Charge) ≥ 55%, the minimum charge is reduced to 40%.
- **Summer Mode**:
    - Minimum charge is set to 10%.
    - Maximum charge is capped at 97%.
- Activation occurs through a checkbox in the adapter settings, and the timeframes are defined by the winter start and end dates.

## Battery Calibration

The Battery Calibration feature supports an automated process:

1. **Start**:
    - The adapter reduces the `minSOC` setting to 1% to discharge the battery.
2. **Charging**:
    - After reaching <1% SOC, the `minSOC` setting is increased to 99%.
3. **Completion**:
    - Once 99% SOC is reached, the adapter resumes normal operation.

Battery calibration can be activated in the expert settings.

## Feed-in Control

The Feed-in Control feature allows configuration of the maximum charge (`maxSOC`) to determine whether excess energy is fed into the grid:

- **97% (Feed-in active)**:
    - Excess energy is fed into the grid when the battery exceeds 97% SOC.
- **100% (Feed-in disabled)**:
    - No excess energy is fed into the grid.

## Datapoints

The adapter dynamically creates datapoints based on the information returned by the CCU:

| Datapoint                   | Description                            |
|-----------------------------|----------------------------------------|
| `<deviceId>.SOC`            | Battery Charge Level.                  |
| `<deviceId>.PV_power_total` | Total PV Power.                        |
| `<deviceId>.batteriesInfo`  | Battery Info.                          |
| `<deviceId>.convertersInfo` | Converter Status.                      |
| `<deviceId>.settings.*`     | Device-specific settings. (only Cloud) |
| `<deviceId>.sendcommand.*`  | Control commands for the CCU.          |

## Notes

- Changes to datapoints in the `<deviceId>.sendcommand` section are automatically detected and sent to the CCU.
- If issues occur with missing datapoints or unexpected behavior, restart the adapter.

## Errors

- **Error processing data**:
    - `deviceId` not available → Restart the adapter after entering CCU information.


- **Entries on the APP website (online) will be reset**:
    - Use only the `maxxi.local` website or the CCU's IP address to make manual entries. When using sendCommand control commands, online entries will be overwritten.

