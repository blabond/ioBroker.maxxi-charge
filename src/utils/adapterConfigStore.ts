import type { AdapterInstance } from '../types/shared';

export async function updateAdapterNativeConfig(
    adapter: AdapterInstance,
    changes: Record<string, unknown>,
): Promise<void> {
    const adapterConfigId = `system.adapter.${adapter.namespace}`;
    const object = await adapter.getForeignObjectAsync(adapterConfigId);

    if (!object) {
        throw new Error(`Adapter configuration ${adapterConfigId} not found.`);
    }

    object.native = {
        ...object.native,
        ...changes,
    };

    await adapter.setForeignObjectAsync(adapterConfigId, object);
}
