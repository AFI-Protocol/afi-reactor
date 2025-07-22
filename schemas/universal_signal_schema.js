"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SignalSchema = void 0;
var zod_1 = require("zod");
exports.SignalSchema = zod_1.z.object({
    id: zod_1.z.string(),
    source: zod_1.z.string(),
    timestamp: zod_1.z.string(),
    data: zod_1.z.any(),
});
