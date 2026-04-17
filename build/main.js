"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const adapter_1 = __importDefault(require("./adapter"));
const createAdapter = (options) => new adapter_1.default(options);
if (require.main !== module) {
    module.exports = createAdapter;
}
else {
    createAdapter();
}
//# sourceMappingURL=main.js.map