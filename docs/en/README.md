# IoBroker.Maxxi-Charge

**ioBroker.MaxxiCharge** is an adapter for the ioBroker system that enables the integration and control of MaxxiCharge CCU devices. The adapter allows reading device data, adjusting configurations, and sending control commands.

## Features

- **Data Query**:
  - Reads information such as IP address, status, or performance of the CCU.
  - Automatically creates dynamic datapoints for device data.
- **Configuration**:
  - Adjusts parameters such as maximum output power, thresholds, or charging behavior.
  - **Summer/Winter Mode**: Dynamically adjusts charging parameters based on the season.
- **Control Commands**:
  - Dynamic datapoints (`<deviceId>.sendcommand`) for sending commands to the CCU.
- **Flexible Query Interval (Cloud Mode)**:
  - Users can adjust the CCU data query interval between 10 and 60 seconds.
- **Error Handling**:
  - Documents errors and provides fallback mechanisms.

## Requirements

| Component                | Description                                             |
|--------------------------|---------------------------------------------------------|
| **MaxxiCharge CCU**      | Supported device with network connection.               |
| **ioBroker**             | Installed ioBroker instance.                            |
| **Node.js**              | Current version of Node.js (see ioBroker requirements). |

## Installation

1. **Configure the Adapter**:
   - Enter the name of the CCU (`Maxxi CCU Name`).
   - Select API Mode (Cloud or Local).
   - If using Local-API, enter the following under `Api-Route` in the CCU: `http://"IP":"PORT"`.

## Configuration Options

| Setting                   | Description                                             |
|---------------------------|---------------------------------------------------------|
| **Maxxi CCU Name**        | Name or IP address of the Maxxi CCU.                    |
| **CCU Query Interval**    | Interval (10-60 seconds) for querying CCU data in Cloud Mode. |
| **Summer/Winter Mode**    | Automatically adjusts charging parameters based on defined winter dates. |
| **Port for Local-API**    | Defines the port on which the Local-API listens.         |

## Summer / Winter Mode

The Summer/Winter Mode dynamically adjusts the charging parameters:

- **Winter Mode**:
  - Minimum charge is set to 70% every day at 8:00 AM.
  - If the SOC (State of Charge) ≥ 55%, the minimum charge is reduced to 40%.
- **Summer Mode**:
  - Minimum charge is set to 10%.
  - Maximum charge is capped at 97%.
- Activation occurs through a checkbox in the adapter settings, and the timeframes are defined by the winter start and end dates.

## Datapoints

The adapter dynamically creates datapoints based on the information returned by the CCU:

### Examples of Datapoints:

| Datapoint                       | Description                                      |
|---------------------------------|--------------------------------------------------|
| `<deviceId>.systeminfo.ip_addr` | IP address of the CCU.                           |
| `<deviceId>.settings.*`         | Device-specific settings.                        |
| `<deviceId>.sendcommand.*`      | Control commands for the CCU.                    |

## Notes

- Changes to datapoints in the `<deviceId>.sendcommand` section are automatically detected and sent to the CCU.

## Errors

- Error processing data: `deviceId` not available -> Restart the adapter after entering CCU information.
