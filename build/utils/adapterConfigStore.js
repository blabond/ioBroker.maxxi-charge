"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateAdapterNativeConfig = updateAdapterNativeConfig;
async function updateAdapterNativeConfig(adapter, changes) {
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
//# sourceMappingURL=adapterConfigStore.js.map
