"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const adapter_1 = __importDefault(require("./adapter"));
if (module.parent) {
    module.exports = (options) => new adapter_1.default(options);
}
else {
    (() => new adapter_1.default())();
}
//# sourceMappingURL=main.js.map