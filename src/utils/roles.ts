const ROLE_MAPPING: Record<string, ioBroker.StateCommon["role"]> = {
  soc: "value.battery",
  temperature: "value.temperature",
  voltage: "value.voltage",
  current: "value.current",
  power: "value.power",
  uptime: "value.time",
  date: "value.datetime",
  error: "sensor.alarm",
  isdaytime: "indicator",
  wifistrength: "value.signal",
  firmwareversion: "info.firmware",
  ip_addr: "info.ip",
  ccutotalpower: "value.power",
  pv_power_total: "value.power",
  batteryvoltage: "value.voltage",
  batterycurrent: "value.current",
  batterypower: "value.power",
  batterysoc: "value.battery",
  ccutemperature: "value.temperature",
  ccuvoltage: "value.voltage",
  ccucurrent: "value.current",
  ccupower: "value.power",
  microcurve: "value",
  numberofbatteries: "value",
  numberofconverters: "value",
  serverip: "info.ip",
  meterip: "info.ip",
  standby_power: "value.power",
};

export function determineRole(key: string): ioBroker.StateCommon["role"] {
  const normalizedKey = key.toLowerCase();

  for (const [pattern, role] of Object.entries(ROLE_MAPPING)) {
    if (normalizedKey.includes(pattern)) {
      return role;
    }
  }

  return "value";
}
