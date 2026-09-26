import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { crc32, deflateRawSync, inflateRawSync } from "node:zlib";

/**
 * Read-only views of an offline catalogue package: a directory on disk, or
 * a single archive (.ifcatalog / .zip). Both expose the same tiny surface
 * and both enforce the same safety rules, because a package is untrusted
 * input even when it comes from a USB stick:
 *
 *  - entry names are normalized and must stay inside the package
 *    (no "..", no absolute paths, no drive letters, no backslash tricks,
 *    no NUL bytes, no duplicate names that could overwrite one another);
 *  - symbolic links are never followed or read;
 *  - sizes and compression ratios are capped (decompression bombs);
 *  - every archive member's declared size and CRC-32 must match its bytes.
 */
export interface PackageSource {
  readonly kind: "directory" | "archive";
  list(): string[];
  size(path: string): number;
  read(path: string): Uint8Array;
}
export class PackageError extends Error {}

export const packageLimits = {
  maxEntries: 200_000,
  maxFileBytes: 256 * 1024 * 1024,
  maxTotalBytes: 6 * 1024 * 1024 * 1024,
  maxCompressionRatio: 250,
  maxNameLength: 240,
};

/** Returns the safe, normalized relative path or throws. */
export function safeEntryName(name: string): string {
  if (name.includes("\0")) throw new PackageError("A file name contains a NUL byte.");
  if (name.length === 0 || name.length > packageLimits.maxNameLength) throw new PackageError("A file name is empty or too long.");
  const unified = name.replace(/\\/g, "/");
  if (unified.startsWith("/") || /^[A-Za-z]:/.test(unified)) throw new PackageError(`"${name}" is an absolute path.`);
  const parts = unified.split("/");
  if (parts.some((p) => p === "..")) throw new PackageError(`"${name}" tries to leave the package folder.`);
  const clean = parts.filter((p) => p && p !== ".");
  if (!clean.length) throw new PackageError("A file name is empty.");
  return clean.join("/");
}

export class DirectorySource implements PackageSource {
  readonly kind = "directory" as const;
  private readonly root: string;
  private readonly files: string[];
  constructor(dir: string) {
    const st = lstatSync(dir, { throwIfNoEntry: false });
    if (!st) throw new PackageError("The package folder does not exist.");
    if (!st.isDirectory()) throw new PackageError("The package path is not a folder.");
    this.root = realpathSync(dir);
    this.files = [];
    const walk = (current: string, depth: number) => {
      if (depth > 6) throw new PackageError("The package folder is nested too deeply.");
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        const full = join(current, entry.name);
        const info = lstatSync(full);
        if (info.isSymbolicLink()) throw new PackageError(`"${entry.name}" is a symbolic link; links are not allowed in a package.`);
        if (info.isDirectory()) walk(full, depth + 1);
        else if (info.isFile()) {
          this.files.push(safeEntryName(relative(this.root, full)));
          if (this.files.length > packageLimits.maxEntries) throw new PackageError("The package has too many files.");
        }
      }
    };
    walk(this.root, 0);
  }
  list() {
    return [...this.files].sort();
  }
  private locate(path: string): string {
    const name = safeEntryName(path);
    if (!this.files.includes(name)) throw new PackageError(`"${path}" is not in the package.`);
    const full = resolve(this.root, name);
    if (full !== this.root && !full.startsWith(this.root + sep)) throw new PackageError(`"${path}" is outside the package folder.`);
    if (lstatSync(full).isSymbolicLink()) throw new PackageError(`"${path}" is a symbolic link.`);
    return full;
  }
  size(path: string) {
    return lstatSync(this.locate(path)).size;
  }
  read(path: string) {
    const full = this.locate(path);
    if (lstatSync(full).size > packageLimits.maxFileBytes) throw new PackageError(`"${path}" is larger than the ${packageLimits.maxFileBytes / 1024 / 1024} MB per-file limit.`);
    return new Uint8Array(readFileSync(full));
  }
}

interface ZipEntry {
  name: string;
  method: number;
  compressed: number;
  size: number;
  crc: number;
  offset: number;
}
const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

/** A minimal, hardened ZIP reader (stored + deflate; no ZIP64, no encryption). */
export class ZipSource implements PackageSource {
  readonly kind = "archive" as const;
  private readonly entries = new Map<string, ZipEntry>();
  constructor(private readonly bytes: Uint8Array) {
    if (bytes.length < 22) throw new PackageError("The file is not a package archive.");
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65_535); i--)
      if (u32(bytes, i) === 0x06054b50) {
        eocd = i;
        break;
      }
    if (eocd < 0) throw new PackageError("The file is not a package archive (no directory found).");
    const total = u16(bytes, eocd + 10);
    const dirSize = u32(bytes, eocd + 12);
    const dirOffset = u32(bytes, eocd + 16);
    if (total === 0xffff || dirSize === 0xffffffff || dirOffset === 0xffffffff) throw new PackageError("ZIP64 archives are not supported.");
    if (total > packageLimits.maxEntries) throw new PackageError("The archive has too many files.");
    if (dirOffset + dirSize > bytes.length) throw new PackageError("The archive directory is corrupt.");
    let p = dirOffset;
    let declaredTotal = 0;
    for (let n = 0; n < total; n++) {
      if (u32(bytes, p) !== 0x02014b50) throw new PackageError("The archive directory is corrupt.");
      const flags = u16(bytes, p + 8);
      const method = u16(bytes, p + 10);
      const crc = u32(bytes, p + 16);
      const compressed = u32(bytes, p + 20);
      const size = u32(bytes, p + 24);
      const nameLen = u16(bytes, p + 28);
      const extraLen = u16(bytes, p + 30);
      const commentLen = u16(bytes, p + 32);
      const externalAttrs = u32(bytes, p + 38);
      const offset = u32(bytes, p + 42);
      const rawName = new TextDecoder("utf-8").decode(bytes.subarray(p + 46, p + 46 + nameLen));
      p += 46 + nameLen + extraLen + commentLen;
      if (rawName.endsWith("/")) continue; // directory entry
      if (flags & 1) throw new PackageError("Encrypted archives are not supported.");
      if ((externalAttrs >>> 16 & 0xf000) === 0xa000) throw new PackageError(`"${rawName}" is a symbolic link; links are not allowed in a package.`);
      if (method !== 0 && method !== 8) throw new PackageError(`"${rawName}" uses an unsupported compression method.`);
      const name = safeEntryName(rawName);
      if (this.entries.has(name)) throw new PackageError(`"${name}" appears twice in the archive.`);
      if (size > packageLimits.maxFileBytes) throw new PackageError(`"${name}" is larger than the ${packageLimits.maxFileBytes / 1024 / 1024} MB per-file limit.`);
      if (compressed > 0 && size / compressed > packageLimits.maxCompressionRatio) throw new PackageError(`"${name}" has a suspicious compression ratio.`);
      declaredTotal += size;
      if (declaredTotal > packageLimits.maxTotalBytes) throw new PackageError("The archive would expand beyond the size limit.");
      if (offset + 30 > bytes.length) throw new PackageError("The archive is corrupt.");
      this.entries.set(name, { name, method, compressed, size, crc, offset });
    }
  }
  list() {
    return [...this.entries.keys()].sort();
  }
  size(path: string) {
    const e = this.entries.get(safeEntryName(path));
    if (!e) throw new PackageError(`"${path}" is not in the package.`);
    return e.size;
  }
  read(path: string): Uint8Array {
    const e = this.entries.get(safeEntryName(path));
    if (!e) throw new PackageError(`"${path}" is not in the package.`);
    const b = this.bytes;
    if (u32(b, e.offset) !== 0x04034b50) throw new PackageError(`"${path}" is corrupt.`);
    const start = e.offset + 30 + u16(b, e.offset + 26) + u16(b, e.offset + 28);
    if (start + e.compressed > b.length) throw new PackageError(`"${path}" is truncated.`);
    const raw = b.subarray(start, start + e.compressed);
    let data: Uint8Array;
    if (e.method === 0) data = raw;
    else {
      try {
        data = new Uint8Array(inflateRawSync(raw, { maxOutputLength: e.size + 1 }));
      } catch {
        throw new PackageError(`"${path}" could not be decompressed (corrupt or larger than declared).`);
      }
    }
    if (data.length !== e.size) throw new PackageError(`"${path}" does not match its declared size.`);
    if (crc32(data) >>> 0 !== e.crc) throw new PackageError(`"${path}" failed its integrity check (CRC).`);
    return data;
  }
}

export const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Builds a stored-only ZIP (used by tests and by a future exporter). */
export function buildZip(files: Record<string, Uint8Array | string>, opts: { symlink?: string[]; deflate?: boolean } = {}): Uint8Array {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = typeof content === "string" ? Buffer.from(content) : Buffer.from(content);
    const deflated = opts.deflate ? deflateRawSync(data) : data;
    const nameBytes = Buffer.from(name);
    const crc = crc32(data) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(opts.deflate ? 8 : 0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    chunks.push(local, nameBytes, deflated);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(opts.deflate ? 8 : 0, 10);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(deflated.length, 20);
    dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(nameBytes.length, 28);
    if (opts.symlink?.includes(name)) dir.writeUInt32LE((0xa1ff << 16) >>> 0, 38);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, nameBytes);
    offset += local.length + nameBytes.length + deflated.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...chunks, centralBuf, end]));
}
