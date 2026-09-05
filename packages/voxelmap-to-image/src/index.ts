import { readFileSync, writeFileSync } from "node:fs";
import AdmZip from "adm-zip";
import { PNG } from "pngjs";

type Endianness = "big" | "little";

interface Options {
  input: string;
  output: string;
  width?: number;
  height?: number;
  endianness: Endianness;
}

function parseArgs(argv: string[]): Options {
  const opts: Partial<Options> = { endianness: "big", output: "out.png" };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = argv[i + 1];
    switch (arg) {
      case "--input":
        opts.input = value;
        i++;
        break;
      case "--output":
        opts.output = value;
        i++;
        break;
      case "--width":
        opts.width = Number(value);
        i++;
        break;
      case "--height":
        opts.height = Number(value);
        i++;
        break;
      case "--endianness":
        opts.endianness = value === "little" ? "little" : "big";
        i++;
        break;
    }
  }
  if (!opts.input) {
    throw new Error("missing --input <file.zip|file.bin>");
  }
  return opts as Options;
}

function extractRawPixelBuffer(inputPath: string): Buffer {
  if (!inputPath.endsWith(".zip")) {
    return readFileSync(inputPath);
  }
  const zip = new AdmZip(inputPath);
  const entries = zip.getEntries();
  if (entries.length === 0) {
    throw new Error(`zip ${inputPath} has no entries`);
  }
  return entries[0].getData();
}

function inferSquareDimension(pixelCount: number): number {
  const side = Math.sqrt(pixelCount);
  if (!Number.isInteger(side)) {
    throw new Error(
      `cannot infer square dimensions from ${pixelCount} pixels, pass --width and --height`,
    );
  }
  return side;
}

function decodeArgbToRgba(
  buf: Buffer,
  width: number,
  height: number,
  endianness: Endianness,
): Buffer {
  const pixelCount = width * height;
  if (buf.length < pixelCount * 4) {
    throw new Error(
      `buffer too small: expected ${pixelCount * 4} bytes for ${width}x${height}, got ${buf.length}`,
    );
  }
  const rgba = Buffer.alloc(pixelCount * 4);
  for (let i = 0; i < pixelCount; i++) {
    const argb =
      endianness === "big" ? buf.readInt32BE(i * 4) : buf.readInt32LE(i * 4);
    const a = (argb >>> 24) & 0xff;
    const r = (argb >>> 16) & 0xff;
    const g = (argb >>> 8) & 0xff;
    const b = argb & 0xff;
    rgba[i * 4] = r;
    rgba[i * 4 + 1] = g;
    rgba[i * 4 + 2] = b;
    rgba[i * 4 + 3] = a;
  }
  return rgba;
}

function writePng(rgba: Buffer, width: number, height: number, outputPath: string): void {
  const png = new PNG({ width, height });
  rgba.copy(png.data);
  writeFileSync(outputPath, PNG.sync.write(png));
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  const raw = extractRawPixelBuffer(opts.input);

  const width = opts.width ?? inferSquareDimension(raw.length / 4);
  const height = opts.height ?? width;

  const rgba = decodeArgbToRgba(raw, width, height, opts.endianness);
  writePng(rgba, width, height, opts.output);

  console.log(`wrote ${opts.output} (${width}x${height})`);
}

main();
