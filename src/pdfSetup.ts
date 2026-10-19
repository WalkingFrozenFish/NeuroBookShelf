import { getDocument, PDFWorker } from "pdfjs-dist";
import PdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?worker";
import openjpegUrl from "pdfjs-dist/wasm/openjpeg.wasm?url";

export function openPdf(data: Uint8Array) {
  const port = new PdfWorker();
  const worker = PDFWorker.create({ port });
  const task = getDocument({
    data,
    worker,
    wasmUrl: wasmDirectory(),
    standardFontDataUrl: assetUrl("pdfjs-standard-fonts/"),
  });
  const destroy = task.destroy.bind(task);
  task.destroy = () =>
    destroy().finally(() => {
      worker.destroy();
      port.terminate();
    });
  return task;
}

function assetUrl(path: string): string {
  return new URL(`${import.meta.env.BASE_URL}${path}`, window.location.href).href;
}

function wasmDirectory(): string {
  const sample = new URL(openjpegUrl, window.location.href);
  if (sample.pathname.endsWith("/openjpeg.wasm")) {
    return new URL("./", sample).href;
  }
  return assetUrl("pdfjs-wasm/");
}
