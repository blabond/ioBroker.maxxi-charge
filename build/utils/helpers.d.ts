export declare function nameToId(
  value: string | number | null | undefined,
): string;
export declare function normalizeDeviceId(
  value: string | number | null | undefined,
): string;
export declare function validateInterval(
  value: number,
  min?: number,
  max?: number,
): number;
export declare function clampNumber(
  value: number,
  min?: number,
  max?: number,
): number | null;
export declare function parseInteger(
  value: string | number | undefined,
  fallback: number,
): number;
export declare function parseBoolean(
  value: string | number | boolean | undefined,
): boolean;
export declare function sleep(ms: number): Promise<void>;
export declare function isRecord(
  value: unknown,
): value is Record<string, unknown>;
export declare function extractRelativeId(
  namespace: string,
  fullId: string,
): string | null;
export declare function normalizeIpAddress(
  remoteAddress: string | undefined,
): string;
export declare function serializeComparable(value: unknown): string;
export declare function areValuesEqual(left: unknown, right: unknown): boolean;
export declare function buildComparableObjectDefinition(definition: {
  type: string;
  common: Record<string, unknown>;
  native: Record<string, unknown>;
}): string;
//# sourceMappingURL=helpers.d.ts.map
