/* ============================================================
   db.js — IndexedDB 数据层
   封装所有 IndexedDB 操作，挂载到 window.db
   ============================================================ */

window.db = (function () {
  const DB_NAME = 'QuotationDB';
  const DB_VERSION = 1;

  let dbInstance = null;
  let _cache = null;  // In-memory cache of all quotation_rows; null = not loaded

  // ── Private: Promisify IDBRequest ──
  function promisify(request) {
    return new Promise(function (resolve, reject) {
      request.onsuccess = function () {
        resolve(request.result);
      };
      request.onerror = function () {
        reject(request.error);
      };
    });
  }

  // ── Private: Get/Create database connection ──
  async function getDB() {
    if (dbInstance) return dbInstance;

    return new Promise(function (resolve, reject) {
      var request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = function (e) {
        var db = e.target.result;

        // quotation_files store
        if (!db.objectStoreNames.contains('quotation_files')) {
          var filesStore = db.createObjectStore('quotation_files', {
            keyPath: 'id',
            autoIncrement: true,
          });
          filesStore.createIndex('file_hash', 'file_hash', { unique: true });
        }

        // quotation_rows store
        if (!db.objectStoreNames.contains('quotation_rows')) {
          var rowsStore = db.createObjectStore('quotation_rows', {
            keyPath: 'id',
            autoIncrement: true,
          });
          rowsStore.createIndex('file_id', 'file_id', { unique: false });
          rowsStore.createIndex('model', 'model', { unique: false });
        }
      };

      request.onsuccess = function (e) {
        dbInstance = e.target.result;
        dbInstance.onclose = function () {
          dbInstance = null;
        };
        resolve(dbInstance);
      };

      request.onerror = function (e) {
        reject(e.target.error);
      };

      request.onblocked = function () {
        reject(new Error('Database upgrade blocked. Please close other tabs.'));
      };
    });
  }

  // ── Public: Initialize database ──
  async function init() {
    try {
      await getDB();
      return true;
    } catch (err) {
      console.error('db.init() failed:', err);
      throw err;
    }
  }

  // ── Public: Search rows by keyword ──
  async function search(query, fileId) {
    var db = await getDB();
    var lowerQuery = query.toLowerCase().trim();
    if (!lowerQuery) return [];

    return new Promise(function (resolve, reject) {
      var tx = db.transaction('quotation_rows', 'readonly');
      var store = tx.objectStore('quotation_rows');
      var results = [];

      var request = store.openCursor();
      request.onsuccess = function (e) {
        var cursor = e.target.result;
        if (cursor) {
          var row = cursor.value;
          // Prefer model index, but also check all row_data
          var model = (row.model || '').toString().toLowerCase();

          if (model.indexOf(lowerQuery) !== -1) {
            if (fileId === undefined || fileId === null || row.file_id === fileId) {
              results.push(row);
            }
          } else {
            // Check row_data
            var rowDataArr = row.row_data || [];
            var matched = false;
            for (var j = 0; j < rowDataArr.length; j++) {
              var cell = (rowDataArr[j] != null ? rowDataArr[j] : '').toString().toLowerCase();
              if (cell.indexOf(lowerQuery) !== -1) {
                matched = true;
                break;
              }
            }
            if (matched) {
              if (fileId === undefined || fileId === null || row.file_id === fileId) {
                results.push(row);
              }
            }
          }
          cursor.continue();
        } else {
          resolve(results);
        }
      };
      request.onerror = function (e) {
        reject(e.target.error);
      };
    });
  }

  // ── Public: Get all files ──
  async function getFiles() {
    var db = await getDB();
    return new Promise(function (resolve, reject) {
      var tx = db.transaction('quotation_files', 'readonly');
      var store = tx.objectStore('quotation_files');
      var request = store.getAll();
      request.onsuccess = function () {
        var files = request.result || [];
        // Sort by created_at descending (newest first)
        files.sort(function (a, b) {
          return (b.created_at || '').localeCompare(a.created_at || '');
        });
        resolve(files);
      };
      request.onerror = function (e) {
        reject(e.target.error);
      };
    });
  }

  // ── Public: Get single file ──
  async function getFile(id) {
    var db = await getDB();
    return new Promise(function (resolve, reject) {
      var tx = db.transaction('quotation_files', 'readonly');
      var store = tx.objectStore('quotation_files');
      var request = store.get(id);
      request.onsuccess = function () {
        resolve(request.result || null);
      };
      request.onerror = function (e) {
        reject(e.target.error);
      };
    });
  }

  // ── Public: Get file by hash (for dedup) ──
  async function getFileByHash(hash) {
    var db = await getDB();
    return new Promise(function (resolve, reject) {
      var tx = db.transaction('quotation_files', 'readonly');
      var store = tx.objectStore('quotation_files');
      var index = store.index('file_hash');
      var request = index.get(hash);
      request.onsuccess = function () {
        resolve(request.result || null);
      };
      request.onerror = function (e) {
        reject(e.target.error);
      };
    });
  }

  // ── Public: Save file and its rows (atomic transaction) ──
  async function saveFile(fileRecord, rows) {
    var db = await getDB();

    return new Promise(function (resolve, reject) {
      var tx = db.transaction(['quotation_files', 'quotation_rows'], 'readwrite');
      var filesStore = tx.objectStore('quotation_files');
      var rowsStore = tx.objectStore('quotation_rows');

      var addFileRequest = filesStore.add(fileRecord);

      addFileRequest.onsuccess = function () {
        var fileId = addFileRequest.result;

        // Add all rows with file_id
        var rowPromises = [];
        for (var i = 0; i < rows.length; i++) {
          rows[i].file_id = fileId;
          var rowReq = rowsStore.add(rows[i]);
          rowPromises.push(promisify(rowReq));
        }

        Promise.all(rowPromises)
          .then(function () {
            resolve(fileId);
          })
          .catch(function (err) {
            tx.abort();
            reject(err);
          });
      };

      addFileRequest.onerror = function (e) {
        reject(e.target.error);
      };

      tx.oncomplete = function () {
        // Transaction completed
      };
      tx.onerror = function (e) {
        reject(e.target.error);
      };
    });
  }

  // ── Public: Update file (replace old data with new) ──
  async function updateFile(fileId, fileRecord, rows) {
    var db = await getDB();

    return new Promise(function (resolve, reject) {
      var tx = db.transaction(['quotation_files', 'quotation_rows'], 'readwrite');
      var filesStore = tx.objectStore('quotation_files');
      var rowsStore = tx.objectStore('quotation_rows');

      // Update file record
      fileRecord.id = fileId;
      var putFileRequest = filesStore.put(fileRecord);

      // Delete old rows for this file
      var index = rowsStore.index('file_id');
      var cursorRequest = index.openCursor(IDBKeyRange.only(fileId));

      cursorRequest.onsuccess = function (e) {
        var cursor = e.target.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };

      putFileRequest.onsuccess = function () {
        // After deleting old rows and updating file record, add new rows
        // We need to wait for the cursor to finish. Use tx.oncomplete.
      };

      tx.oncomplete = function () {
        // Now add new rows in a new transaction
        addRowsInNewTx(fileId, rows).then(resolve).catch(reject);
      };

      tx.onerror = function (e) {
        reject(e.target.error);
      };
    });

    async function addRowsInNewTx(fileId, rows) {
      var db = await getDB();
      return new Promise(function (resolve, reject) {
        var tx = db.transaction('quotation_rows', 'readwrite');
        var rowsStore = tx.objectStore('quotation_rows');

        for (var i = 0; i < rows.length; i++) {
          rows[i].file_id = fileId;
          rowsStore.add(rows[i]);
        }

        tx.oncomplete = function () {
          resolve();
        };
        tx.onerror = function (e) {
          reject(e.target.error);
        };
      });
    }
  }

  // ── Public: Delete file and all its rows ──
  async function deleteFile(fileId) {
    var db = await getDB();

    return new Promise(function (resolve, reject) {
      var tx = db.transaction(['quotation_files', 'quotation_rows'], 'readwrite');
      var filesStore = tx.objectStore('quotation_files');
      var rowsStore = tx.objectStore('quotation_rows');

      // Delete file record
      filesStore.delete(fileId);

      // Delete all associated rows
      var index = rowsStore.index('file_id');
      var cursorRequest = index.openCursor(IDBKeyRange.only(fileId));

      cursorRequest.onsuccess = function (e) {
        var cursor = e.target.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };

      tx.oncomplete = function () {
        resolve();
      };
      tx.onerror = function (e) {
        reject(e.target.error);
      };
    });
  }

  // ── Public: Export file rows (for Excel export) ──
  async function exportFile(fileId) {
    var db = await getDB();

    return new Promise(function (resolve, reject) {
      var rows = [];
      var tx = db.transaction('quotation_rows', 'readonly');
      var store = tx.objectStore('quotation_rows');
      var index = store.index('file_id');
      var request = index.openCursor(IDBKeyRange.only(fileId));

      request.onsuccess = function (e) {
        var cursor = e.target.result;
        if (cursor) {
          rows.push(cursor.value);
          cursor.continue();
        } else {
          // Sort by category_order, then row_order
          rows.sort(function (a, b) {
            if (a.category_order !== b.category_order) {
              return a.category_order - b.category_order;
            }
            return a.row_order - b.row_order;
          });
          resolve(rows);
        }
      };
      request.onerror = function (e) {
        reject(e.target.error);
      };
    });
  }

  // ── Public: Get statistics ──
  async function getStats() {
    var db = await getDB();

    var files = await getFiles();
    var fileCount = files.length;

    return new Promise(function (resolve, reject) {
      var tx = db.transaction('quotation_rows', 'readonly');
      var store = tx.objectStore('quotation_rows');
      var countRequest = store.count();

      countRequest.onsuccess = function () {
        var rowCount = countRequest.result;

        // Rough storage estimate via navigator.storage.estimate()
        var storagePromise;
        if (navigator.storage && navigator.storage.estimate) {
          storagePromise = navigator.storage.estimate().then(function (est) {
            return est.usage || 0;
          }).catch(function () {
            return estimateFromData(files, rowCount);
          });
        } else {
          storagePromise = Promise.resolve(estimateFromData(files, rowCount));
        }

        storagePromise.then(function (bytes) {
          resolve({
            fileCount: fileCount,
            rowCount: rowCount,
            storageBytes: bytes,
          });
        });
      };

      countRequest.onerror = function (e) {
        reject(e.target.error);
      };
    });
  }

  // ── Private: Rough storage estimation ──
  function estimateFromData(files, rowCount) {
    var fileBytes = 0;
    for (var i = 0; i < files.length; i++) {
      fileBytes += JSON.stringify(files[i]).length;
    }
    // Rough average per row (typically ~300-800 bytes)
    var estimatedRowBytes = rowCount * 500;
    return fileBytes + estimatedRowBytes;
  }

  // ── Public: Get all rows (for cache loading) ──
  async function getAllRows() {
    var db = await getDB();
    return new Promise(function (resolve, reject) {
      var tx = db.transaction('quotation_rows', 'readonly');
      var store = tx.objectStore('quotation_rows');
      var request = store.getAll();
      request.onsuccess = function () {
        resolve(request.result || []);
      };
      request.onerror = function (e) {
        reject(e.target.error);
      };
    });
  }

  // ── Public: Load rows into memory cache ──
  async function loadCache() {
    try {
      _cache = await getAllRows();
    } catch (err) {
      console.error('loadCache() failed:', err);
      _cache = null;
    }
  }

  // ── Public: Search in memory (synchronous, no IndexedDB) ──
  function searchInMemory(query, fileIds) {
    if (!_cache) return [];

    var lowerQuery = query.toLowerCase().trim();
    if (!lowerQuery) return [];

    var shouldFilter = fileIds && fileIds.length > 0;
    var results = [];

    for (var i = 0; i < _cache.length; i++) {
      var row = _cache[i];
      var model = (row.model || '').toString().toLowerCase();

      if (model.indexOf(lowerQuery) !== -1) {
        if (!shouldFilter || fileIds.indexOf(row.file_id) !== -1) {
          results.push(row);
          continue;
        }
      }

      var rowDataArr = row.row_data || [];
      for (var j = 0; j < rowDataArr.length; j++) {
        var cell = (rowDataArr[j] != null ? rowDataArr[j] : '').toString().toLowerCase();
        if (cell.indexOf(lowerQuery) !== -1) {
          if (!shouldFilter || fileIds.indexOf(row.file_id) !== -1) {
            results.push(row);
            break;
          }
        }
      }
    }

    return results;
  }

  // ── Public: Refresh cache after writes (reload from IndexedDB) ──
  async function refreshCache() {
    try {
      _cache = await getAllRows();
    } catch (err) {
      console.error('refreshCache() failed:', err);
      _cache = null;
    }
  }

  // ── Public API ──
  return {
    init: init,
    search: search,
    getFiles: getFiles,
    getFile: getFile,
    getFileByHash: getFileByHash,
    saveFile: saveFile,
    updateFile: updateFile,
    deleteFile: deleteFile,
    exportFile: exportFile,
    getStats: getStats,
    getAllRows: getAllRows,
    loadCache: loadCache,
    searchInMemory: searchInMemory,
    refreshCache: refreshCache,
  };
})();
