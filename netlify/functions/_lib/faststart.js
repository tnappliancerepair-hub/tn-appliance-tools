// faststart — move an MP4's `moov` atom (the index a player needs to start) from the
// END of the file to the FRONT, and fix the chunk-offset tables. This is what lets a
// clip stream + play instantly on mobile instead of "loading incomplete." A pure-JS
// port of qt-faststart (no ffmpeg). Safe no-op if the file is already faststart or
// isn't a standard mp4.
'use strict';

function readAtoms(buf, start, end) {
  const atoms = []; let pos = start;
  while (pos + 8 <= end) {
    let size = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    let header = 8;
    if (size === 1) { size = Number(buf.readBigUInt64BE(pos + 8)); header = 16; }
    else if (size === 0) { size = end - pos; }
    if (size < header || pos + size > end) break; // malformed — bail
    atoms.push({ type, pos, size, header });
    pos += size;
  }
  return atoms;
}

const CONTAINERS = new Set(['moov', 'trak', 'edts', 'mdia', 'minf', 'stbl', 'udta']);

// Recursively add `shift` to every stco (32-bit) / co64 (64-bit) chunk offset.
function patchOffsets(buf, start, end, shift) {
  for (const a of readAtoms(buf, start, end)) {
    const cs = a.pos + a.header, ce = a.pos + a.size;
    if (a.type === 'stco') {
      const count = buf.readUInt32BE(cs + 4); let p = cs + 8;
      for (let i = 0; i < count && p + 4 <= ce; i++) { buf.writeUInt32BE((buf.readUInt32BE(p) + shift) >>> 0, p); p += 4; }
    } else if (a.type === 'co64') {
      const count = buf.readUInt32BE(cs + 4); let p = cs + 8;
      for (let i = 0; i < count && p + 8 <= ce; i++) { buf.writeBigUInt64BE(buf.readBigUInt64BE(p) + BigInt(shift), p); p += 8; }
    } else if (CONTAINERS.has(a.type)) {
      patchOffsets(buf, cs, ce, shift);
    }
  }
}

// Returns a faststart Buffer (or the original if already faststart / not applicable).
function faststart(buf) {
  try {
    const atoms = readAtoms(buf, 0, buf.length);
    const ftyp = atoms.find((a) => a.type === 'ftyp');
    const moov = atoms.find((a) => a.type === 'moov');
    const mdat = atoms.find((a) => a.type === 'mdat');
    if (!ftyp || !moov || !mdat) return buf;
    if (moov.pos < mdat.pos) return buf; // already faststart

    const moovBuf = Buffer.from(buf.subarray(moov.pos, moov.pos + moov.size));
    patchOffsets(moovBuf, 0, moovBuf.length, moov.size); // mdat shifts forward by moov.size

    const parts = [buf.subarray(ftyp.pos, ftyp.pos + ftyp.size), moovBuf];
    for (const a of atoms) { if (a === ftyp || a === moov) continue; parts.push(buf.subarray(a.pos, a.pos + a.size)); }
    const out = Buffer.concat(parts);
    return out.length === buf.length ? out : buf.length && out.length >= buf.length - moov.size ? out : buf;
  } catch (_) { return buf; }
}

module.exports = { faststart };
