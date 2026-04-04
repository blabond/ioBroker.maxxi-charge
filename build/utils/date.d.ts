import type { DayMonth } from "../types/shared";
export declare function getDateValue(date: DayMonth | null): number | null;
export declare function parseDayMonth(
  value: string | undefined,
): DayMonth | null;
export declare function isInWrappedRange(
  currentValue: number | null,
  fromValue: number | null,
  toValue: number | null,
): boolean;
//# sourceMappingURL=date.d.ts.map
