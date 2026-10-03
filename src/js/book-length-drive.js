import { completeWordCount, hasCompleteWordCount } from './book-length.js';
import { isBookLengthReady } from './book-length-queue.js';

const checksum = value => typeof value === 'string' && /^[a-f0-9]{32}$/i.test(value) ? value.toLowerCase() : null;
const bytes = book => Number(book?.content?.size ?? book?.size ?? book?.sizeBytes);

/** Optional metadata in the existing Drive reading-state JSON. The checksum
 * identifies the Drive original; page counts and partial/legacy counts cannot
 * masquerade as a complete text count on a second device. */
export function driveBookLength(book) {
  const remoteChecksum = checksum(book?.driveContentChecksum);
  if (!isBookLengthReady(book) || !book.driveFileId || !Number.isSafeInteger(bytes(book)) || bytes(book) < 0) return null;
  if (book.contentDriveChecksum && checksum(book.contentDriveChecksum) !== remoteChecksum) return null;
  // Unverified local bytes may keep their count in state JSON, but cannot
  // certify geometry for another device's Drive original.
  const md5Checksum = book.content && !checksum(book.contentDriveChecksum) ? null : remoteChecksum;
  return { schemaVersion:1, driveFileId:book.driveFileId, md5Checksum, byteLength:bytes(book),
    wordCount:book.wordCount, wordCountVersion:book.wordCountVersion, wordCountComplete:true };
}

export function normalizeDriveBookLength(value) {
  if (value?.schemaVersion !== 1 || typeof value.driveFileId !== 'string' || !value.driveFileId
    || value.md5Checksum != null && !checksum(value.md5Checksum)
    || !Number.isSafeInteger(value.byteLength) || value.byteLength < 0
    || !hasCompleteWordCount(value)) return null;
  return { schemaVersion:1, driveFileId:value.driveFileId, md5Checksum:checksum(value.md5Checksum),
    byteLength:value.byteLength, wordCount:value.wordCount, wordCountVersion:value.wordCountVersion,
    wordCountComplete:true };
}

/** Never overwrite a count of the actual local bytes with cloud metadata. A
 * cached original known to be a different Drive revision is measured locally. */
export function wordCountFromDrive(book, value) {
  const length = normalizeDriveBookLength(value);
  if (!length || !length.md5Checksum || isBookLengthReady(book) || length.driveFileId !== book.driveFileId
    || length.md5Checksum !== checksum(book.driveContentChecksum) || length.byteLength !== bytes(book)
    || book.content && checksum(book.contentDriveChecksum) !== length.md5Checksum) return null;
  return { ...completeWordCount(length.wordCount),
    wordCountContentRevision:book.contentRevision || null, lengthDirty:false };
}
