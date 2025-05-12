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
    - Dynamic datapoints (`<deviceId>.sendcommand`) are used to send commands to the CCU.
    - The folder `<deviceId>.VersionControl` is used to change the currently installed CCU version.
    - The folder `<deviceId>.VersionControl.Experimentell not for Use` contains experimental versions and should be used **at your own risk**.
- **Flexible Query Interval (Cloud Mode)**:
    - Users can adjust the CCU data query interval between 10 and 90 seconds.
- **Firmware Version Control**:
    - Automatically retrieves and categorizes available firmware versions into "Releases" and "Experimental".
    - Enables safe firmware switching through a toggle datapoint under `VersionControl.Releases`.

## Requirements

| Component                | Description                                             |
|--------------------------|---------------------------------------------------------|
| **MaxxiCharge CCU**      | Supported device with network connection.               |
| **ioBroker**             | Installed ioBroker instance.                            |
| **Node.js**              | Current version of Node.js (see ioBroker requirements). |

## Installation

1. **Configure the Adapter**:
    - Select the API mode (**Cloud - Server 1**, **Cloud - Server 2**, or **Local**).
        - **Cloud S1 / Cloud S2**:
            - Enter the **CCU name** (e.g., `maxxi-XXXXXX-YYY`).
            - Enter the **e-mail address** associated with your Maxxisun account.
            - Enter the **local IP address** of your MaxxiCharge device (e.g., `192.168.1.123`).
      - **Local:** Enter the ioBroker address on the MaxxiCharge webpage (`maxxi.local`) under `Api-Route`: `http://"ioBroker IP":"PORT"`.
2. **Important Update Note**:
    - Delete the `.sendcommand` folder and restart the adapter if updating from an older version. (< 1.4.0)

**Info:** Cloud Server 1 provides more datapoints than Cloud Server 2.

## Configuration Options

| Setting                 | Description                                                                                                                                                                                                    |
|-------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Maxxi CCU Name**      | Name or IP address of the Maxxi CCU.                                                                                                                                                                           |
| **CCU Query Interval**  | Interval (10-90 seconds) for querying CCU data in Cloud Mode.                                                                                                                                                  |
| **Summer/Winter Mode**  | Automatically adjusts charging parameters based on defined winter dates.                                                                                                                                       |
| **Port for Local-API**  | Defines the port on which the Local-API listens.                                                                                                                                                               |
| **Feed-in Control**     | Configures whether excess energy is fed into the grid.                                                                                                                                                         |
| **Battery Calibration** | Starts the automated calibration process for the battery.                                                                                                                                                      |
| **BKW-Mode*             | At a battery level of ≥ 97%, the script enables BKW mode to feed a constant 600–800 W into the grid alongside household use, potentially receiving compensation if registered as a balcony power system (BKW). |

## Summer / Winter Mode

The Summer/Winter Mode dynamically adjusts the charging parameters:

- **Winter Mode**:
    - Minimum charge is set to 60% every day at 8:00 AM.
    - If the SOC (State of Charge) ≥ 55%, the minimum charge is reduced to 40%.
- **Summer Mode**:
    - Minimum charge is set to 10%.
    - Maximum charge is capped at 97%.
- Activation occurs through a checkbox in the adapter settings, and the timeframes are defined by the winter start and end dates.

## BKW Mode

The BKW mode allows surplus energy from the battery storage system to be intentionally fed into the public power grid.
When the battery’s state of charge (SOC) reaches ≥ 97%, the adapter automatically activates BKW mode.
In this mode, a fixed power (e.g., 600 or 800 W) is continuously fed into the grid alongside the normal household consumption.
This is useful if a balcony power system (BKW) has been officially registered and grid feed-in compensation is possible.

If the battery SOC drops below 97%, BKW mode is automatically deactivated, and the additional grid feed-in is reduced or stopped.
The process runs fully automatically and requires no further user interaction.

Note: BKW mode is only activated if Enable BKW mode is selected in the adapter settings and battery calibration mode (batterycalibration) is disabled.

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

- **90% / 97% (Feed-in active)**:
    - Excess energy is fed into the grid when the battery exceeds 97% SOC.
- **100% (Feed-in disabled)**:
    - No excess energy is fed into the grid.

## Datapoints

The adapter dynamically creates datapoints based on the information returned by the CCU. Here is a small excerpt of the datapoint structure layout:

| Datapoint                     | Description                                          |
|-------------------------------|------------------------------------------------------|
| `<deviceId>.SOC`              | Battery Charge Level.                                |
| `<deviceId>.PV_power_total`   | Total PV Power.                                      |
| `<deviceId>.batteriesInfo`    | Battery Info.                                        |
| `<deviceId>.convertersInfo`   | Converter Status.                                    |
| `<deviceId>.settings.*`       | Device-specific settings. (only Cloud)               |
| `<deviceId>.sendcommand.*`    | Control commands for the CCU.                        |
| `<deviceId>.VersionControl.*` | Tools for changing CCU version. (only in Cloud mode) |

## Notes

- Changes to datapoints in the `<deviceId>.sendcommand` section are automatically detected and sent to the CCU.
- If issues occur with missing datapoints or unexpected behavior, restart the adapter.

## Errors

- **Error processing data**:
    - `deviceId` not available → Restart the adapter after entering CCU information.

- **Entries on the APP website (online) will be reset**:
    - Use only the `maxxi.local` website or the CCU's IP address to make manual entries. When using sendCommand control commands, online entries will be overwritten.

