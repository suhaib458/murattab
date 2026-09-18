import { PDFiumLibrary } from "@hyzyla/pdfium";
import { PNG } from "pngjs";

export const MAX_PDF_PAGES = 5;
/**
 * Cumulative pixel budget across ALL rendered pages in the PDF document (not per-page).
 * 16 Megapixels total (e.g. ~4 high-res pages of 2000x2000).
 */
export const MAX_TOTAL_RENDERED_PIXELS = 16_000_000;
export const DEFAULT_PDF_SCALE = 1.5;

export interface RasterizedImage {
  bytes: Uint8Array;
  mimeType: "image/png";
  width: number;
  height: number;
  pageNumber: number;
}

export interface RasterizePdfOptions {
  maxPages?: number;
  maxPixels?: number;
  scale?: number;
  signal?: AbortSignal;
}

export async function rasterizePdfToImages(
  pdfBytes: Uint8Array,
  options?: RasterizePdfOptions
): Promise<RasterizedImage[]> {
  const maxPages = options?.maxPages ?? MAX_PDF_PAGES;
  const maxPixels = options?.maxPixels ?? MAX_TOTAL_RENDERED_PIXELS;
  const scale = options?.scale ?? DEFAULT_PDF_SCALE;
  const signal = options?.signal;

  if (signal?.aborted) {
    throw new Error("AI_PROVIDER_TIMEOUT");
  }

  let library: any = null;
  let doc: any = null;

  try {
    library = await PDFiumLibrary.init();
    if (signal?.aborted) {
      throw new Error("AI_PROVIDER_TIMEOUT");
    }

    try {
      doc = await library.loadDocument(pdfBytes);
    } catch {
      throw new Error("PDF_INVALID_FORMAT");
    }

    if (!doc) {
      throw new Error("PDF_INVALID_FORMAT");
    }

    const pages = Array.from(doc.pages()) as any[];
    if (pages.length === 0) {
      throw new Error("PDF_EMPTY");
    }

    if (pages.length > maxPages) {
      throw new Error("PDF_PAGE_LIMIT_EXCEEDED");
    }

    const images: RasterizedImage[] = [];
    let accumulatedPixels = 0;

    for (let index = 0; index < pages.length; index++) {
      if (signal?.aborted) {
        throw new Error("AI_PROVIDER_TIMEOUT");
      }

      const page = pages[index];
      const pageNumber = index + 1;

      const rendered = await page.render({
        render: "bitmap",
        scale
      });

      if (!rendered || !rendered.width || !rendered.height || !rendered.data) {
        throw new Error("PDF_RENDER_FAILED");
      }

      const pagePixels = rendered.width * rendered.height;
      accumulatedPixels += pagePixels;

      if (accumulatedPixels > maxPixels) {
        throw new Error("PDF_PIXEL_LIMIT_EXCEEDED");
      }

      const png = new PNG({ width: rendered.width, height: rendered.height });
      png.data = Buffer.from(rendered.data);
      const pngBuffer = PNG.sync.write(png);

      images.push({
        bytes: new Uint8Array(pngBuffer),
        mimeType: "image/png",
        width: rendered.width,
        height: rendered.height,
        pageNumber
      });
    }

    return images;
  } finally {
    if (doc) {
      try {
        doc.destroy();
      } catch {
        // ignore cleanup errors
      }
    }
    if (library) {
      try {
        library.destroy();
      } catch {
        // ignore cleanup errors
      }
    }
  }
}
