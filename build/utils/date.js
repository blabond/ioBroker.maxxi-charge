"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDateValue = getDateValue;
exports.parseDayMonth = parseDayMonth;
exports.isInWrappedRange = isInWrappedRange;
function getDateValue(date) {
  if (!date) {
    return null;
  }
  return date.month * 100 + date.day;
}
function parseDayMonth(value) {
  if (typeof value !== "string") {
    return null;
  }
  const [dayText, monthText] = value.split(".");
  const day = Number(dayText);
  const month = Number(monthText);
  if (
    !Number.isInteger(day) ||
    !Number.isInteger(month) ||
    day < 1 ||
    day > 31 ||
    month < 1 ||
    month > 12
  ) {
    return null;
  }
  return { day, month };
}
function isInWrappedRange(currentValue, fromValue, toValue) {
  if (currentValue === null || fromValue === null || toValue === null) {
    return false;
  }
  if (fromValue < toValue) {
    return currentValue >= fromValue && currentValue < toValue;
  }
  return (
    (currentValue >= fromValue || currentValue < toValue) &&
    currentValue !== toValue
  );
}
//# sourceMappingURL=date.js.map
