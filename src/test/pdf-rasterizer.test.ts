import { describe, expect, it } from "vitest";
import { PNG } from "pngjs";
import {
  DEFAULT_PDF_SCALE,
  MAX_PDF_PAGES,
  MAX_TOTAL_RENDERED_PIXELS,
  rasterizePdfToImages
} from "@/domain/ai/pdf-rasterizer";

/**
 * Creates a valid multi-page PDF buffer without external dependencies.
 * Each page contains visual drawing commands (filled rectangle + text).
 */
function createMinimalPdfBuffer(pageCount = 2): Uint8Array {
  const objects: string[] = [];

  // Catalog
  objects.push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj");

  // Page kids array
  const kids = Array.from({ length: pageCount }, (_, i) => `${3 + i} 0 R`).join(" ");
  objects.push(`2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>\nendobj`);

  // Page objects & Content objects
  const contentStartObj = 3 + pageCount + 1; // object ID where contents start (5 + pageCount)
  const fontObjId = 3 + pageCount; // Font object

  for (let i = 0; i < pageCount; i++) {
    const pageId = 3 + i;
    const contentId = contentStartObj + i;
    objects.push(
      `${pageId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 ${fontObjId} 0 R >> >> /Contents ${contentId} 0 R >>\nendobj`
    );
  }

  // Font object
  objects.push(`${fontObjId} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj`);

  // Content streams (different rectangle position and color on each page)
  for (let i = 0; i < pageCount; i++) {
    const contentId = contentStartObj + i;
    // Page 1 has rect at (20, 20), Page 2 at (100, 100), etc.
    const x = 20 + i * 40;
    const y = 20 + i * 40;
    const stream = `BT /F1 16 Tf 30 150 Td (SCHEDULE PAGE ${i + 1}) Tj ET ${x} ${y} 50 50 re f`;
    objects.push(`${contentId} 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj`);
  }

  let body = "%PDF-1.4\n";
  const offsets: number[] = [0];

  for (const obj of objects) {
    offsets.push(Buffer.byteLength(body, "utf-8"));
    body += obj + "\n";
  }

  const xrefOffset = Buffer.byteLength(body, "utf-8");
  body += `xref\n0 ${offsets.length}\n`;
  body += "0000000000 65535 f \n";

  for (let i = 1; i < offsets.length; i++) {
    const padded = String(offsets[i]).padStart(10, "0");
    body += `${padded} 00000 n \n`;
  }

  body += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(body, "utf-8");
}

describe("PDF Rasterizer (pure WASM PDFium + pngjs)", () => {
  it("renders a valid 2-page PDF to individual decodable PNG images with correct ordering", async () => {
    const pdfBytes = createMinimalPdfBuffer(2);
    const images = await rasterizePdfToImages(pdfBytes, { scale: 1 });

    expect(images).toHaveLength(2);

    // Verify Page 1
    const page1 = images[0];
    expect(page1.pageNumber).toBe(1);
    expect(page1.mimeType).toBe("image/png");
    expect(page1.width).toBe(200);
    expect(page1.height).toBe(200);
    expect(page1.bytes.byteLength).toBeGreaterThan(100);

    // Verify Page 2
    const page2 = images[1];
    expect(page2.pageNumber).toBe(2);
    expect(page2.mimeType).toBe("image/png");
    expect(page2.width).toBe(200);
    expect(page2.height).toBe(200);
    expect(page2.bytes.byteLength).toBeGreaterThan(100);

    // Decode PNGs with pngjs to verify valid PNG structure and dimensions
    const decoded1 = PNG.sync.read(Buffer.from(page1.bytes));
    expect(decoded1.width).toBe(200);
    expect(decoded1.height).toBe(200);

    const decoded2 = PNG.sync.read(Buffer.from(page2.bytes));
    expect(decoded2.width).toBe(200);
    expect(decoded2.height).toBe(200);

    // Verify visual non-empty content (at least one non-transparent, non-white pixel)
    const hasDrawnPixels1 = decoded1.data.some((byte, idx) => {
      // Check for black fill (r=0, g=0, b=0, a=255) from the filled rectangle
      if (idx % 4 === 3 && byte > 0) {
        // alpha > 0
        const r = decoded1.data[idx - 3];
        const g = decoded1.data[idx - 2];
        const b = decoded1.data[idx - 1];
        return r === 0 && g === 0 && b === 0;
      }
      return false;
    });
    expect(hasDrawnPixels1).toBe(true);

    // Verify Page 1 and Page 2 have different drawn pixel coordinates (preserving multi-page ordering)
    expect(Buffer.compare(Buffer.from(page1.bytes), Buffer.from(page2.bytes))).not.toBe(0);
  });

  it("applies custom scale correctly", async () => {
    const pdfBytes = createMinimalPdfBuffer(1);
    const images = await rasterizePdfToImages(pdfBytes, { scale: 2 });

    expect(images).toHaveLength(1);
    expect(images[0].width).toBe(400); // 200 * 2
    expect(images[0].height).toBe(400); // 200 * 2
  });

  it("rejects PDFs exceeding the maximum page limit (MAX_PDF_PAGES) with PDF_PAGE_LIMIT_EXCEEDED", async () => {
    // Generate a 6-page PDF (MAX_PDF_PAGES is 5)
    const pdfBytes = createMinimalPdfBuffer(6);
    await expect(rasterizePdfToImages(pdfBytes)).rejects.toThrow("PDF_PAGE_LIMIT_EXCEEDED");
  });

  it("rejects PDFs exceeding the rendered pixel budget with PDF_PIXEL_LIMIT_EXCEEDED", async () => {
    const pdfBytes = createMinimalPdfBuffer(1);
    // 200x200 = 40,000 pixels. Set limit to 10,000 pixels
    await expect(
      rasterizePdfToImages(pdfBytes, { maxPixels: 10_000 })
    ).rejects.toThrow("PDF_PIXEL_LIMIT_EXCEEDED");
  });

  it("enforces MAX_TOTAL_RENDERED_PIXELS as cumulative across ALL pages, not per-page", async () => {
    // 2-page PDF: each page is 200x200 = 40,000 pixels.
    // Total across 2 pages = 80,000 pixels.
    const pdfBytes = createMinimalPdfBuffer(2);

    // If limit was per-page (40,000 <= 60,000), each page would pass.
    // Because it is cumulative: Page 1 (40,000) + Page 2 (40,000) = 80,000 > 60,000 -> throws!
    await expect(
      rasterizePdfToImages(pdfBytes, { scale: 1, maxPixels: 60_000 })
    ).rejects.toThrow("PDF_PIXEL_LIMIT_EXCEEDED");

    // But if maxPixels is 100,000 (> 80,000 cumulative), both pages pass:
    const images = await rasterizePdfToImages(pdfBytes, { scale: 1, maxPixels: 100_000 });
    expect(images).toHaveLength(2);
  });

  it("rejects invalid/corrupt PDF bytes with PDF_INVALID_FORMAT", async () => {
    const corruptBytes = new Uint8Array([1, 2, 3, 4, 5]);
    await expect(rasterizePdfToImages(corruptBytes)).rejects.toThrow("PDF_INVALID_FORMAT");
  });

  it("aborts promptly when AbortSignal is cancelled", async () => {
    const controller = new AbortController();
    controller.abort();

    const pdfBytes = createMinimalPdfBuffer(1);
    await expect(
      rasterizePdfToImages(pdfBytes, { signal: controller.signal })
    ).rejects.toThrow("AI_PROVIDER_TIMEOUT");
  });
});
