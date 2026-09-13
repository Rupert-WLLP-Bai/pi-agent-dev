import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";

/**
 * Writes an uploaded contract to disk under its Source Record id, keeping the
 * original extension so the file is recognisable. Returns the stored path,
 * which is what the Source Record's `originalPath` points at.
 *
 * `UPLOAD_DIR` is read per call rather than at module load, so a process (or a
 * test) can point it somewhere else for a single run.
 */
export async function saveOriginal(
  sourceRecordId: string,
  buffer: Buffer,
  filename: string,
): Promise<string> {
  const dir = process.env.UPLOAD_DIR ?? "var/uploads";
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${sourceRecordId}${extname(filename)}`);
  await writeFile(path, buffer);
  return path;
}

/** Reads back a stored original for the download endpoint. */
export async function readOriginal(path: string): Promise<Buffer> {
  return readFile(path);
}
