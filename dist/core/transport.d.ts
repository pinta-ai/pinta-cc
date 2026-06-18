import { DiskTransport } from "@pinta-ai/core";
import type { PintaConfig } from "./config.js";
export declare class Transport extends DiskTransport {
    constructor(config: PintaConfig);
}
