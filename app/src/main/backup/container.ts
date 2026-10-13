/**
 * The MINDSPACE backup container (format version 1).
 *
 *   header  "MSBACKUP" | u16 formatVersion | u8 encrypted | u8 0           (12 bytes)
 *   [encrypted only]  salt(16) | u8 log2N | u8 r | u8 p | u8 0 | noncePrefix(8)   (28 bytes)
 *   body S  entry* | u16 0 | sha256(all bytes of S before this trailer)(32)
 *   entry   u16 nameLen | name (utf8) | u64 size | data
 *
 * Encrypted files wrap S in an AEAD stream: AES-256-GCM (node:crypto) in
 * 1 MiB chunks, key = scrypt(password, salt). Every chunk is
 * `u32 length | ciphertext | 16-byte tag`, nonce = noncePrefix | u32 counter,
 * and the additional authenticated data is the whole file header plus a
 * "final chunk" byte, so reordering, truncation and header edits fail
 * authentication. This is the standard STREAM construction over a vetted
 * primitive; no custom cryptography.
 *
 * The first entry is always manifest.json. Nothing is trusted before the
 * trailer hash, the per-file checksums and (if encrypted) every tag verify.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { open, stat, type FileHandle } from 'node:fs/promises'
import { BackupError } from './errors'
import { isAllowedEntryName, looksUnsafe, MANIFEST_NAME } from './paths'

export const MAGIC = Buffer.from('MSBACKUP', 'ascii')
export const FORMAT_VERSION = 1
const BASE_HEADER = 12
const ENC_HEADER = 28
const CHUNK = 1024 * 1024
const TAG = 16
const SCRYPT = { logN: 17, r: 8, p: 1 }

export const LIMITS = {
  manifestBytes: 8 * 1024 * 1024,
  entries: 20_000,
  totalBytes: 16 * 1024 ** 3
}

export interface PackFile {
  name: string
  source: string
  size: number
}

export interface Entry {
  name: string
  /** Offset of the data inside the plaintext body file. */
  offset: number
  size: number
}

export interface Header {
  formatVersion: number
  encrypted: boolean
}

export async function readHeader(file: string): Promise<Header> {
  const fh = await open(file, 'r')
  try {
    const buf = Buffer.alloc(BASE_HEADER)
    const { bytesRead } = await fh.read(buf, 0, BASE_HEADER, 0)
    if (bytesRead < BASE_HEADER || !buf.subarray(0, 8).equals(MAGIC)) throw new BackupError('corrupt', 'This is not a MINDSPACE backup file.')
    const formatVersion = buf.readUInt16BE(8)
    const flag = buf[10]!
    if (flag > 1) throw new BackupError('corrupt', 'This backup file is damaged.')
    return { formatVersion, encrypted: flag === 1 }
  } finally {
    await fh.close()
  }
}

async function deriveKey(password: string, salt: Buffer, logN: number, r: number, p: number): Promise<Buffer> {
  const N = 2 ** logN
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, 32, { N, r, p, maxmem: 128 * N * r * p + 8 * 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(key)))
  })
}

// ---------------------------------------------------------------- writing

interface Sink {
  write(buf: Buffer): Promise<void>
  finish(): Promise<void>
}

async function fileSink(fh: FileHandle): Promise<Sink> {
  let pos = 0
  return {
    async write(buf) {
      let off = 0
      while (off < buf.length) {
        const { bytesWritten } = await fh.write(buf, off, buf.length - off, pos)
        off += bytesWritten
        pos += bytesWritten
      }
    },
    async finish() {
      await fh.sync()
    }
  }
}

function encryptedSink(inner: Sink, header: Buffer, key: Buffer, noncePrefix: Buffer): Sink {
  let pending: Buffer = Buffer.alloc(0)
  let counter = 0
  const seal = async (plain: Buffer, final: boolean) => {
    const nonce = Buffer.alloc(12)
    noncePrefix.copy(nonce, 0)
    nonce.writeUInt32BE(counter++, 8)
    const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG })
    cipher.setAAD(Buffer.concat([header, Buffer.from([final ? 1 : 0])]))
    const ct = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()])
    const len = Buffer.alloc(4)
    len.writeUInt32BE(ct.length)
    await inner.write(Buffer.concat([len, ct]))
  }
  return {
    async write(buf) {
      pending = pending.length ? Buffer.concat([pending, buf]) : buf
      // Keep at least one byte pending so the last chunk can be sealed as final.
      while (pending.length > CHUNK) {
        await seal(pending.subarray(0, CHUNK), false)
        pending = pending.subarray(CHUNK)
      }
    },
    async finish() {
      await seal(pending, true)
      pending = Buffer.alloc(0)
      await inner.finish()
    }
  }
}

export async function writeContainer(opts: {
  dest: string
  manifest: Buffer
  files: PackFile[]
  password?: string | undefined
  onProgress?: (done: number, total: number) => void
}): Promise<void> {
  if (opts.manifest.length > LIMITS.manifestBytes) throw new BackupError('too_large', 'The backup manifest is too large.')
  const fh = await open(opts.dest, 'wx')
  try {
    const base = Buffer.alloc(BASE_HEADER)
    MAGIC.copy(base, 0)
    base.writeUInt16BE(FORMAT_VERSION, 8)
    base[10] = opts.password ? 1 : 0
    const out = await fileSink(fh)
    let sink: Sink = out
    if (opts.password) {
      const salt = randomBytes(16)
      const noncePrefix = randomBytes(8)
      const enc = Buffer.alloc(ENC_HEADER)
      salt.copy(enc, 0)
      enc[16] = SCRYPT.logN
      enc[17] = SCRYPT.r
      enc[18] = SCRYPT.p
      noncePrefix.copy(enc, 20)
      const header = Buffer.concat([base, enc])
      const key = await deriveKey(opts.password, salt, SCRYPT.logN, SCRYPT.r, SCRYPT.p)
      await out.write(header)
      sink = encryptedSink(out, header, key, noncePrefix)
    } else {
      await out.write(base)
    }

    const hash = createHash('sha256')
    const put = async (buf: Buffer) => {
      hash.update(buf)
      await sink.write(buf)
    }
    const entryHeader = (name: string, size: number) => {
      const nameBuf = Buffer.from(name, 'utf8')
      const h = Buffer.alloc(2 + nameBuf.length + 8)
      h.writeUInt16BE(nameBuf.length, 0)
      nameBuf.copy(h, 2)
      h.writeBigUInt64BE(BigInt(size), 2 + nameBuf.length)
      return h
    }

    await put(entryHeader(MANIFEST_NAME, opts.manifest.length))
    await put(opts.manifest)
    const total = opts.files.reduce((n, f) => n + f.size, 0)
    let done = 0
    for (const f of opts.files) {
      await put(entryHeader(f.name, f.size))
      let sent = 0
      for await (const chunk of createReadStream(f.source, { highWaterMark: 256 * 1024 })) {
        const buf = chunk as Buffer
        sent += buf.length
        done += buf.length
        await put(buf)
        opts.onProgress?.(done, total)
      }
      if (sent !== f.size) throw new BackupError('interrupted', 'A file changed while the backup was being written.')
    }
    await put(Buffer.from([0, 0]))
    // The trailer is part of the stream but not of the hash it carries.
    await sink.write(hash.digest())
    await sink.finish()
  } finally {
    await fh.close()
  }
}

// ---------------------------------------------------------------- reading

export interface OpenedContainer {
  header: Header
  /** File holding the plaintext body S, and where S starts in it. */
  bodyPath: string
  bodyOffset: number
  entries: Entry[]
  /** Size of the original file on disk. */
  fileBytes: number
}

/** Decrypts an encrypted container into `plainOut`, authenticating every chunk. */
export async function decryptToFile(file: string, password: string, plainOut: string): Promise<void> {
  const src = await open(file, 'r')
  try {
    const size = (await src.stat()).size
    const head = Buffer.alloc(BASE_HEADER + ENC_HEADER)
    const { bytesRead } = await src.read(head, 0, head.length, 0)
    if (bytesRead < head.length) throw new BackupError('corrupt', 'This backup file is damaged.')
    const logN = head[BASE_HEADER + 16]!
    const r = head[BASE_HEADER + 17]!
    const p = head[BASE_HEADER + 18]!
    if (logN < 10 || logN > 18 || r < 1 || r > 8 || p < 1 || p > 2) throw new BackupError('corrupt', 'This backup file is damaged.')
    const salt = head.subarray(BASE_HEADER, BASE_HEADER + 16)
    const noncePrefix = head.subarray(BASE_HEADER + 20, BASE_HEADER + 28)
    const key = await deriveKey(password, salt, logN, r, p)
    const out = await open(plainOut, 'wx')
    try {
      let pos = head.length
      let counter = 0
      let outPos = 0
      let written = 0
      while (pos < size) {
        const lenBuf = Buffer.alloc(4)
        if ((await src.read(lenBuf, 0, 4, pos)).bytesRead < 4) throw new BackupError('corrupt', 'This backup file is damaged or incomplete.')
        const len = lenBuf.readUInt32BE(0)
        if (len < TAG || len > CHUNK + TAG || pos + 4 + len > size) throw new BackupError('corrupt', 'This backup file is damaged or incomplete.')
        const ct = Buffer.alloc(len)
        if ((await src.read(ct, 0, len, pos + 4)).bytesRead < len) throw new BackupError('corrupt', 'This backup file is damaged or incomplete.')
        pos += 4 + len
        const final = pos >= size
        const nonce = Buffer.alloc(12)
        noncePrefix.copy(nonce, 0)
        nonce.writeUInt32BE(counter, 8)
        let plain: Buffer
        try {
          const d = createDecipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG })
          d.setAAD(Buffer.concat([head, Buffer.from([final ? 1 : 0])]))
          d.setAuthTag(ct.subarray(len - TAG))
          plain = Buffer.concat([d.update(ct.subarray(0, len - TAG)), d.final()])
        } catch {
          throw counter === 0
            ? new BackupError('wrong_password', 'The password is incorrect, or the backup file is damaged.')
            : new BackupError('corrupt', 'The encrypted backup failed authentication: it is damaged or has been modified.')
        }
        counter++
        written += plain.length
        if (written > LIMITS.totalBytes + LIMITS.manifestBytes + LIMITS.entries * 600) throw new BackupError('too_large', 'The backup is larger than this version of MINDSPACE accepts.')
        await out.write(plain, 0, plain.length, outPos)
        outPos += plain.length
      }
      if (counter === 0) throw new BackupError('corrupt', 'This backup file is damaged or incomplete.')
    } finally {
      await out.close()
    }
  } finally {
    await src.close()
  }
}

async function readExact(fh: FileHandle, length: number, position: number): Promise<Buffer> {
  const buf = Buffer.alloc(length)
  const { bytesRead } = await fh.read(buf, 0, length, position)
  if (bytesRead < length) throw new BackupError('corrupt', 'This backup file is damaged or incomplete.')
  return buf
}

/**
 * Opens a container: decrypts if needed (into `tmpDir`), walks the entry
 * table with every size bounded, and verifies the trailer hash. Throws
 * BackupError on anything off. Does not look at the manifest content.
 */
export async function openContainer(file: string, password: string | undefined, tmpDir: string): Promise<OpenedContainer> {
  const header = await readHeader(file)
  if (header.formatVersion > FORMAT_VERSION || header.formatVersion < 1) {
    throw new BackupError('unsupported_format', `This backup uses format version ${header.formatVersion}, which this version of MINDSPACE cannot read.`)
  }
  const fileBytes = (await stat(file)).size
  let bodyPath = file
  let bodyOffset = BASE_HEADER
  if (header.encrypted) {
    if (!password) throw new BackupError('password_required', 'This backup is encrypted. Enter its password.')
    bodyPath = `${tmpDir}/body.bin`
    bodyOffset = 0
    await decryptToFile(file, password, bodyPath)
  }
  const fh = await open(bodyPath, 'r')
  try {
    const bodySize = (await fh.stat()).size
    const end = bodySize
    let pos = bodyOffset
    const entries: Entry[] = []
    let total = 0
    for (;;) {
      if (pos + 2 > end) throw new BackupError('corrupt', 'This backup file is damaged or incomplete.')
      const nameLen = (await readExact(fh, 2, pos)).readUInt16BE(0)
      pos += 2
      if (nameLen === 0) break
      if (nameLen > 400 || entries.length >= LIMITS.entries) throw new BackupError('corrupt', 'This backup file is damaged or has too many files.')
      const name = (await readExact(fh, nameLen, pos)).toString('utf8')
      pos += nameLen
      const size64 = (await readExact(fh, 8, pos)).readBigUInt64BE(0)
      pos += 8
      if (size64 > BigInt(LIMITS.totalBytes)) throw new BackupError('too_large', 'A file in this backup is larger than this version of MINDSPACE accepts.')
      const size = Number(size64)
      if (looksUnsafe(name) || !isAllowedEntryName(name)) throw new BackupError('corrupt', 'This backup contains an unexpected file entry and was rejected.')
      if (entries.some((e) => e.name === name)) throw new BackupError('corrupt', 'This backup contains duplicate entries and was rejected.')
      if (entries.length === 0 && (name !== MANIFEST_NAME || size > LIMITS.manifestBytes)) throw new BackupError('invalid_manifest', 'The backup does not start with a valid manifest.')
      total += size
      if (total > LIMITS.totalBytes) throw new BackupError('too_large', 'This backup is larger than this version of MINDSPACE accepts.')
      if (pos + size > end) throw new BackupError('corrupt', 'This backup file is damaged or incomplete.')
      entries.push({ name, offset: pos, size })
      pos += size
    }
    if (entries.length === 0) throw new BackupError('invalid_manifest', 'The backup contains no manifest.')
    if (pos + 32 !== end) throw new BackupError('corrupt', 'This backup file is damaged or has unexpected trailing data.')
    const stored = await readExact(fh, 32, pos)
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(bodyPath, { start: bodyOffset, end: pos - 1, highWaterMark: 1024 * 1024 })) hash.update(chunk as Buffer)
    if (!hash.digest().equals(stored)) throw new BackupError('checksum', 'The backup failed its integrity check: it is damaged or has been modified.')
    return { header, bodyPath, bodyOffset, entries, fileBytes }
  } finally {
    await fh.close()
  }
}

export async function readEntry(c: OpenedContainer, e: Entry): Promise<Buffer> {
  const fh = await open(c.bodyPath, 'r')
  try {
    return await readExact(fh, e.size, e.offset)
  } finally {
    await fh.close()
  }
}

/** Streams one entry to `dest` (which must not exist) and returns its sha256. */
export async function extractEntry(c: OpenedContainer, e: Entry, dest: string): Promise<string> {
  const hash = createHash('sha256')
  const out = await open(dest, 'wx')
  try {
    let pos = 0
    if (e.size > 0) {
      for await (const chunk of createReadStream(c.bodyPath, { start: e.offset, end: e.offset + e.size - 1, highWaterMark: 256 * 1024 })) {
        const buf = chunk as Buffer
        hash.update(buf)
        await out.write(buf, 0, buf.length, pos)
        pos += buf.length
      }
    }
    await out.sync()
  } finally {
    await out.close()
  }
  return hash.digest('hex')
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path, { highWaterMark: 256 * 1024 })) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

/** sha256 of one entry's data, reporting bytes read. */
export async function sha256Range(c: OpenedContainer, e: Entry, onBytes?: (n: number) => void): Promise<string> {
  const hash = createHash('sha256')
  if (e.size > 0) {
    let n = 0
    for await (const chunk of createReadStream(c.bodyPath, { start: e.offset, end: e.offset + e.size - 1, highWaterMark: 256 * 1024 })) {
      hash.update(chunk as Buffer)
      n += (chunk as Buffer).length
      onBytes?.(n)
    }
  }
  return hash.digest('hex')
}
