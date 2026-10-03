import { expect } from '@playwright/test';

/** Wait for real detached parsing; never seed a synthetic count or revision. */
export async function waitForFinalBookGeometry(page, name) {
  await expect.poll(() => page.evaluate(name => new Promise((resolve, reject) => {
    const request = indexedDB.open('inhouse-read');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, read = db.transaction('books','readonly').objectStore('books').getAll();
      read.onerror = () => { db.close(); reject(read.error); };
      read.onsuccess = () => {
        const book = read.result.find(book => book.name === name); db.close();
        resolve(Boolean(book?.content?.size && book.wordCountComplete === true && book.wordCountVersion === 2 &&
          Number.isSafeInteger(book.wordCount) && book.wordCount >= 0 && book.contentRevision &&
          book.wordCountContentRevision === book.contentRevision));
      };
    };
  }), name), {timeout:30_000}).toBe(true);
}
