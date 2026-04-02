import type { DayMonth } from "../types/shared";

export function getDateValue(date: DayMonth | null): number | null {
  if (!date) {
    return null;
  }

  return date.month * 100 + date.day;
}

export function parseDayMonth(value: string | undefined): DayMonth | null {
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

export function isInWrappedRange(
  currentValue: number | null,
  fromValue: number | null,
  toValue: number | null,
): boolean {
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
