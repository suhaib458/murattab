/**
 * TTU Table Geometry Module.
 *
 * Provides deterministic geometry extraction for TTU schedule tables from OCR results.
 * This module is pure TypeScript: zero React, zero DOM, zero external dependencies.
 */

export * from "./types";
export * from "./text-normalization";
export * from "./header-detector";
export * from "./column-detector";
export * from "./row-detector";
export * from "./cell-builder";
export * from "./parser";
