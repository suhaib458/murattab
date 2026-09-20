/**
 * Text normalization utilities for TTU table parsing.
 *
 * CRITICAL RULE:
 * Normalization is used ONLY for matching, comparison, and anchor classification.
 * Stored raw text in TtuTableCell and TtuCellSegment must always preserve
 * original OCR characters (including bidi marks, spacing, and numbers).
 */

/**
 * Regex matching invisible Unicode Bidirectional control characters
 * and zero-width formatting codes:
 * - \u200E (LRM), \u200F (RLM)
 * - \u202A-\u202E (LRE, RLE, PDF, LRO, RLO)
 * - \u2066-\u2069 (LRI, RLI, FSI, PDI)
 * - \u061C (ALM)
 * - \u200B-\u200D (ZWSP, ZWNJ, ZWJ)
 * - \uFEFF (BOM)
 */
const BIDI_REGEX = /[\u200E\u200F\u202A-\u202E\u2066-\u2069\u061C\u200B-\u200D\uFEFF]/g;

/**
 * Regex matching Arabic diacritical marks (Tashkeel).
 */
const TASHKEEL_REGEX = /[\u064B-\u065F\u0670]/g;

/**
 * Remove all invisible Unicode bidirectional and zero-width control characters.
 * Useful when comparing strings that may contain implicit or explicit bidi embeddings.
 */
export function stripBidiControls(text: string): string {
  if (!text) return "";
  return text.replace(BIDI_REGEX, "");
}

/**
 * Normalize a text string solely for matching purposes (header matching, keywords).
 *
 * Normalization pipeline:
 *   1. Strip bidi control codes
 *   2. Remove Arabic diacritics (tashkeel)
 *   3. Normalize Alef variants (إ, أ, آ, ٱ → ا)
 *   4. Normalize Teh Marbuta (ة → ه)
 *   5. Normalize Alef Maksura (ى → ي)
 *   6. Normalize punctuation separators (replace dots, slashes, dashes with spaces)
 *   7. Collapse multiple spaces and trim
 *   8. Convert ASCII characters to lowercase
 *
 * @param text - Raw input string.
 * @returns Clean normalized string for comparison.
 */
export function normalizeForMatching(text: string): string {
  if (!text) return "";

  return stripBidiControls(text)
    .replace(TASHKEEL_REGEX, "")
    .replace(/\u0640/g, "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[./\\_–—\-:]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}
