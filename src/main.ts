import type * as utils from "@iobroker/adapter-core";
import MaxxiChargeAdapter from "./adapter";

if (module.parent) {
  module.exports = (
    options?: Partial<utils.AdapterOptions>,
  ): MaxxiChargeAdapter => new MaxxiChargeAdapter(options);
} else {
  (() => new MaxxiChargeAdapter())();
}

export {};
