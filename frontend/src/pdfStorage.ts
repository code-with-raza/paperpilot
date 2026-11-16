type StoredPdf = { userId: string; paperId: string; name: string; file: Blob }
const databaseName = 'paperpilot-previews'
const storeName = 'pdfs'

// source: https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(storeName, { keyPath: ['userId', 'paperId'] })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('PDF storage is unavailable.'))
  })
}

export async function loadStoredPdf(userId: string, paperId: string): Promise<StoredPdf | undefined> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readonly')
    const request = transaction.objectStore(storeName).get([userId, paperId])
    transaction.oncomplete = () => { db.close(); resolve(request.result as StoredPdf | undefined) }
    transaction.onabort = () => { db.close(); reject(transaction.error || new Error('Could not restore this PDF.')) }
  })
}

export async function saveStoredPdf(userId: string, paperId: string, file: File): Promise<void> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite')
    transaction.objectStore(storeName).put({ userId, paperId, name: file.name, file } satisfies StoredPdf)
    transaction.oncomplete = () => { db.close(); resolve() }
    transaction.onabort = () => { db.close(); reject(transaction.error || new Error('Could not save this PDF.')) }
  })
}
