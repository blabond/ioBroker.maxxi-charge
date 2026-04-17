export function nameToId(value: string | number | null | undefined): string {
    return String(value ?? '').replace(/[^a-zA-Z0-9_-]/g, '_');
}

export function normalizeDeviceId(value: string | number | null | undefined): string {
    return nameToId(value).toLowerCase();
}

export function validateInterval(value: number, min = 1_000, max = 3_600_000): number {
    if (!Number.isFinite(value)) {
        return min;
    }

    if (value < min) {
        return min;
    }

    if (value > max) {
        return max;
    }

    return value;
}

export function clampNumber(value: number, min?: number, max?: number): number | null {
    if (!Number.isFinite(value)) {
        return null;
    }

    if (typeof min === 'number' && value < min) {
        return min;
    }

    if (typeof max === 'number' && value > max) {
        return max;
    }

    return value;
}

export function parseInteger(value: string | number | undefined, fallback: number): number {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

export function parseBoolean(value: string | number | boolean | undefined): boolean {
    if (typeof value === 'boolean') {
        return value;
    }

    if (typeof value === 'number') {
        return value === 1;
    }

    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
    }

    return false;
}

export function sleep(
    adapter: { setTimeout?(callback: () => void, timeout: number): ioBroker.Timeout | undefined },
    ms: number,
): Promise<void> {
    return new Promise(resolve => {
        if (typeof adapter.setTimeout === 'function') {
            adapter.setTimeout(resolve, ms);
            return;
        }

        setTimeout(resolve, ms);
    });
}

export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

export function extractRelativeId(namespace: string, fullId: string): string | null {
    const prefix = `${namespace}.`;
    return fullId.startsWith(prefix) ? fullId.slice(prefix.length) : null;
}

export function normalizeIpAddress(remoteAddress: string | undefined): string {
    return typeof remoteAddress === 'string' ? remoteAddress.replace(/^::ffff:/, '') : '';
}

function stableSerialize(value: unknown): string {
    if (value === undefined) {
        return 'undefined';
    }

    if (typeof value === 'number' && Number.isNaN(value)) {
        return 'NaN';
    }

    if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
        return JSON.stringify(value);
    }

    if (Array.isArray(value)) {
        return `[${value.map(entry => stableSerialize(entry)).join(',')}]`;
    }

    if (!isRecord(value)) {
        return JSON.stringify({ unsupportedType: typeof value });
    }

    const keys = Object.keys(value).sort();
    return `{${keys.map(key => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`;
}

export function serializeComparable(value: unknown): string {
    return stableSerialize(value);
}

export function areValuesEqual(left: unknown, right: unknown): boolean {
    return Object.is(left, right) || stableSerialize(left) === stableSerialize(right);
}

export function buildComparableObjectDefinition(definition: {
    type: string;
    common: Record<string, unknown>;
    native: Record<string, unknown>;
}): string {
    return stableSerialize(definition);
}
