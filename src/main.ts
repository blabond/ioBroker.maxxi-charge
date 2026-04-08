import type * as utils from "@iobroker/adapter-core";
import MaxxiChargeAdapter from "./adapter";

const createAdapter = (
  options?: Partial<utils.AdapterOptions>,
): MaxxiChargeAdapter => new MaxxiChargeAdapter(options);

if (require.main !== module) {
  module.exports = createAdapter;
} else {
  createAdapter();
}

export {};
