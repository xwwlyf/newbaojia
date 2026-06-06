/* ============================================================
   admin.js — 管理后台逻辑
   上传、删除、更新、导出、Excel 浏览器端解析
   ============================================================ */

window.AdminApp = (function () {
  // ── DOM References ──
  var dropZone, fileInput, fileTable, tbody;
  var progressDiv, progressFill, progressText;
  var duplicateModal, dupMessage, dupBtnReplace, dupBtnSkip, dupBtnCancel;
  var confirmModal, confirmMessage, confirmBtnYes, confirmBtnNo;
  var statFiles, statRows, statStorage;

  // State for dedup handling
  var pendingFileRecord = null;
  var pendingRows = null;
  var pendingFileName = null;

  // ── Initialization ──
  async function init() {
    cacheDom();
    bindEvents();

    // Check SheetJS
    if (typeof XLSX === 'undefined') {
      showToast('Excel 解析库加载失败，请检查网络连接后刷新页面。', 'error', 8000);
      return;
    }

    try {
      await db.init();
    } catch (err) {
      if (err.message && err.message.indexOf('blocked') !== -1) {
        showToast('请关闭其他已打开的本网站标签页后刷新。', 'warning', 6000);
      } else {
        showToast('数据库初始化失败，请检查浏览器是否支持 IndexedDB。', 'error', 6000);
      }
      console.error('db.init() failed:', err);
      return;
    }

    await refreshAll();
  }

  function cacheDom() {
    dropZone = document.getElementById('drop-zone');
    fileInput = document.getElementById('file-input');
    fileTable = document.getElementById('file-table');
    tbody = fileTable.querySelector('tbody');

    progressDiv = document.getElementById('upload-progress');
    progressFill = document.getElementById('progress-fill');
    progressText = document.getElementById('progress-text');

    duplicateModal = document.getElementById('duplicate-modal');
    dupMessage = document.getElementById('dup-message');
    dupBtnReplace = document.getElementById('dup-btn-replace');
    dupBtnSkip = document.getElementById('dup-btn-skip');
    dupBtnCancel = document.getElementById('dup-btn-cancel');

    confirmModal = document.getElementById('confirm-modal');
    confirmMessage = document.getElementById('confirm-message');
    confirmBtnYes = document.getElementById('confirm-btn-yes');
    confirmBtnNo = document.getElementById('confirm-btn-no');

    statFiles = document.getElementById('stat-files');
    statRows = document.getElementById('stat-rows');
    statStorage = document.getElementById('stat-storage');
  }

  function bindEvents() {
    // Upload zone click
    dropZone.addEventListener('click', function () {
      fileInput.click();
    });

    // File input change
    fileInput.addEventListener('change', function (e) {
      var files = e.target.files;
      if (files && files.length > 0) {
        handleFiles(files);
        fileInput.value = '';
      }
    });

    // Drag and drop
    dropZone.addEventListener('dragover', function (e) {
      e.preventDefault();
      dropZone.classList.add('drag-over');
    });
    dropZone.addEventListener('dragleave', function (e) {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
    });
    dropZone.addEventListener('drop', function (e) {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
      var files = e.dataTransfer.files;
      if (files && files.length > 0) {
        handleFiles(files);
      }
    });

    // Duplicate modal
    dupBtnReplace.addEventListener('click', handleDuplicateReplace);
    dupBtnSkip.addEventListener('click', handleDuplicateSkip);
    dupBtnCancel.addEventListener('click', closeDuplicateModal);
    document.getElementById('dup-modal-close').addEventListener('click', closeDuplicateModal);
    duplicateModal.addEventListener('click', function (e) {
      if (e.target === duplicateModal) closeDuplicateModal();
    });

    // Confirm modal
    confirmBtnYes.addEventListener('click', function () {
      var cb = confirmModal._callback;
      closeConfirmModal();
      if (cb) cb();
    });
    confirmBtnNo.addEventListener('click', closeConfirmModal);
    document.getElementById('confirm-modal-close').addEventListener('click', closeConfirmModal);
    confirmModal.addEventListener('click', function (e) {
      if (e.target === confirmModal) closeConfirmModal();
    });
  }

  // ── Refresh All ──
  async function refreshAll() {
    await renderStats();
    await renderFileList();
  }

  // ── Stats Rendering ──
  async function renderStats() {
    try {
      var stats = await db.getStats();
      statFiles.textContent = stats.fileCount;
      statRows.textContent = stats.rowCount.toLocaleString();
      statStorage.textContent = formatBytes(stats.storageBytes);
    } catch (err) {
      console.error('renderStats error:', err);
    }
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }

  // ── File List Rendering ──
  async function renderFileList() {
    try {
      var files = await db.getFiles();
      tbody.innerHTML = '';

      if (files.length === 0) {
        var tr = document.createElement('tr');
        tr.className = 'empty-row';
        tr.innerHTML = '<td colspan="5">暂无报价文件，请上传。</td>';
        tbody.appendChild(tr);
        return;
      }

      for (var i = 0; i < files.length; i++) {
        var f = files[i];
        var tr = document.createElement('tr');
        tr.innerHTML =
          '<td class="file-name-cell" title="' +
          escapeHtml(f.file_name) +
          '">' +
          escapeHtml(f.file_name) +
          '</td>' +
          '<td>' +
          (f.row_count || 0) +
          '</td>' +
          '<td>' +
          (f.cat_count || 0) +
          '</td>' +
          '<td>' +
          formatTime(f.created_at) +
          '</td>' +
          '<td class="actions-cell"></td>';

        var actionsCell = tr.querySelector('.actions-cell');

        // Export button
        var btnExport = document.createElement('button');
        btnExport.className = 'btn btn-outline btn-sm';
        btnExport.textContent = '📥 导出';
        btnExport.title = '导出为 Excel';
        btnExport.addEventListener('click', function (fileId, fileName) {
          return function () {
            exportFileToExcel(fileId, fileName);
          };
        }(f.id, f.file_name));
        actionsCell.appendChild(btnExport);

        // Update button
        var btnUpdate = document.createElement('button');
        btnUpdate.className = 'btn btn-ghost btn-sm';
        btnUpdate.textContent = '🔄 更新';
        btnUpdate.title = '用新文件替换';
        btnUpdate.addEventListener('click', function (fileId) {
          return function () {
            triggerUpdateFile(fileId);
          };
        }(f.id));
        actionsCell.appendChild(btnUpdate);

        // Delete button
        var btnDelete = document.createElement('button');
        btnDelete.className = 'btn btn-danger btn-sm';
        btnDelete.textContent = '🗑 删除';
        btnDelete.title = '删除文件及数据';
        btnDelete.addEventListener('click', function (fileId, fileName) {
          return function () {
            showConfirmModal(
              '确定要删除 <strong>' + escapeHtml(fileName) + '</strong> 吗？此操作不可恢复，所有关联数据将被删除。',
              function () {
                executeDelete(fileId, fileName);
              }
            );
          };
        }(f.id, f.file_name));
        actionsCell.appendChild(btnDelete);

        tbody.appendChild(tr);
      }
    } catch (err) {
      console.error('renderFileList error:', err);
    }
  }

  // ── Handle Files ──
  async function handleFiles(files) {
    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      var name = file.name.toLowerCase();

      // Check extension
      if (!name.endsWith('.xlsx') && !name.endsWith('.xls')) {
        showToast('请上传 .xlsx 或 .xls 格式的文件：' + file.name, 'warning');
        continue;
      }

      // Soft size warning
      if (file.size > 50 * 1024 * 1024) {
        var cont = confirm('文件较大（>50MB），解析可能需要较长时间，是否继续？');
        if (!cont) continue;
      }

      showProgress(true, '正在读取文件...');

      try {
        var arrayBuffer = await readFileAsArrayBuffer(file);
        showProgress(true, '正在解析 Excel...', 30);

        var result = parseExcel(arrayBuffer, file.name);

        if (!result || result.rows.length === 0) {
          showToast('文件为空，未解析到任何数据行：' + file.name, 'warning');
          showProgress(false);
          continue;
        }

        showProgress(true, '正在计算文件指纹...', 60);

        // Compute hash for dedup
        var hash = await computeHash(arrayBuffer);
        result.fileRecord.file_hash = hash;

        showProgress(true, '正在保存数据...', 80);

        // Check for duplicates
        var existing = await db.getFileByHash(hash);
        if (existing) {
          showProgress(false);
          pendingFileRecord = result.fileRecord;
          pendingRows = result.rows;
          pendingFileName = file.name;
          showDuplicateModal(existing.file_name);
          return; // Wait for user decision
        }

        // Save to DB
        await db.saveFile(result.fileRecord, result.rows);

        showProgress(true, '完成！', 100);
        await sleep(300);
        showProgress(false);

        showToast(
          '✅ 上传成功：' +
            result.rows.length +
            ' 行 / ' +
            result.fileRecord.cat_count +
            ' 分类 — ' +
            file.name,
          'success'
        );

        await refreshAll();
      } catch (err) {
        showProgress(false);
        console.error('Upload error:', err);
        if (err.name === 'QuotaExceededError' || (err.message && err.message.indexOf('quota') !== -1)) {
          showToast('浏览器存储空间不足，请删除部分文件后重试。', 'error', 6000);
        } else {
          showToast('文件处理失败：' + (err.message || '未知错误'), 'error');
        }
      }
    }
  }

  // ── File Reading ──
  function readFileAsArrayBuffer(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        resolve(reader.result);
      };
      reader.onerror = function () {
        reject(new Error('文件读取失败'));
      };
      reader.readAsArrayBuffer(file);
    });
  }

  // ── Excel Parsing ──
  function parseExcel(arrayBuffer, fileName) {
    var workbook;
    try {
      workbook = XLSX.read(arrayBuffer, { type: 'array' });
    } catch (e) {
      throw new Error('文件解析失败，请检查文件是否损坏。');
    }

    if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
      throw new Error('文件中没有工作表。');
    }

    var sheetName = workbook.SheetNames[0];
    var sheet = workbook.Sheets[sheetName];

    // Convert to array of arrays
    var data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

    if (!data || data.length === 0) {
      return null;
    }

    // Parse structure
    var rows = [];
    var currentCategory = '未分类';
    var currentCategoryOrder = 0;
    var currentHeader = null;
    var currentModelCol = 0;
    var rowOrderInCategory = 0;
    var categories = new Set();

    for (var i = 0; i < data.length; i++) {
      var row = data[i];
      if (!row || row.length === 0) continue;

      // Count non-empty cells
      var nonEmptyCount = 0;
      var firstNonEmptyIdx = -1;
      for (var j = 0; j < row.length; j++) {
        if (row[j] !== '' && row[j] !== null && row[j] !== undefined) {
          nonEmptyCount++;
          if (firstNonEmptyIdx === -1) firstNonEmptyIdx = j;
        }
      }

      if (nonEmptyCount === 0) continue;

      // Classify row
      if (nonEmptyCount === 1 && firstNonEmptyIdx === 0) {
        var cellValue = String(row[firstNonEmptyIdx]).trim();
        // Category: single column, non-numeric, <= 50 chars
        if (cellValue.length <= 50 && !isNumeric(cellValue)) {
          currentCategory = cellValue;
          currentCategoryOrder++;
          currentHeader = null;
          categories.add(currentCategory);
          rowOrderInCategory = 0;
          continue;
        }
      }

      // Header: after a category, has >=2 cells
      if (currentCategory && !currentHeader && nonEmptyCount >= 2) {
        currentHeader = row.map(function (c) { return String(c).trim(); });
        currentModelCol = detectModelColumn(currentHeader);
        rowOrderInCategory = 0;
        continue;
      }

      // Data row
      if (currentCategory && currentHeader) {
        var model = '';
        if (currentModelCol < row.length) {
          model = String(row[currentModelCol] || '').trim();
        }

        var rowData = row.map(function (c) {
          return c === undefined || c === null ? '' : String(c);
        });

        rows.push({
          file_name: fileName,
          category: currentCategory,
          category_order: currentCategoryOrder,
          model: model,
          header_data: currentHeader.slice(),
          row_data: rowData,
          row_order: rowOrderInCategory,
          created_at: new Date().toISOString(),
        });

        rowOrderInCategory++;
      }
    }

    if (rows.length === 0) {
      return null;
    }

    // Validate: must have at least one model-like column
    // Allow empty model fallback — search still works on row_data

    var now = new Date().toISOString();
    var fileRecord = {
      file_name: fileName,
      file_hash: '', // Will be set after hash computation
      row_count: rows.length,
      cat_count: categories.size || 1,
      created_at: now,
      updated_at: now,
    };

    return { fileRecord: fileRecord, rows: rows };
  }

  // ── Model Column Detection ──
  function detectModelColumn(headerRow) {
    // Priority 1: contains keyword 型号/规格/品名
    var keywords = ['型号', '规格', '品名'];
    for (var i = 0; i < headerRow.length; i++) {
      var h = headerRow[i].toLowerCase();
      for (var j = 0; j < keywords.length; j++) {
        if (h.indexOf(keywords[j]) !== -1) return i;
      }
    }

    // Priority 2: fallback — first column with alphanumeric >= 3 chars
    for (var i = 0; i < headerRow.length; i++) {
      var alphanum = headerRow[i].replace(/[^a-zA-Z0-9]/g, '');
      if (alphanum.length >= 3) return i;
    }

    // Final fallback: first column
    return 0;
  }

  // ── Numeric check ──
  function isNumeric(str) {
    return /^[\d.,\s\-+]+$/.test(str.trim());
  }

  // ── SHA-256 Hash ──
  async function computeHash(arrayBuffer) {
    try {
      var hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
      var hashArray = Array.from(new Uint8Array(hashBuffer));
      var hashHex = hashArray
        .map(function (b) {
          return b.toString(16).padStart(2, '0');
        })
        .join('');
      return hashHex;
    } catch (err) {
      // Fallback for file:// protocol where crypto.subtle is unavailable
      console.warn('crypto.subtle unavailable, using fallback hash');
      var view = new Uint8Array(arrayBuffer.slice(0, 10240));
      var hash = 0;
      for (var i = 0; i < view.length; i++) {
        hash = ((hash << 5) - hash + view[i]) | 0;
      }
      return 'fallback_' + arrayBuffer.byteLength + '_' + Math.abs(hash).toString(16);
    }
  }

  // ── Duplicate Handling ──
  function showDuplicateModal(existingFileName) {
    dupMessage.textContent = '文件已存在：「' + existingFileName + '」。是否覆盖？';
    duplicateModal.classList.add('visible');
  }

  function closeDuplicateModal() {
    duplicateModal.classList.remove('visible');
    pendingFileRecord = null;
    pendingRows = null;
    pendingFileName = null;
  }

  async function handleDuplicateReplace() {
    closeDuplicateModal();
    if (!pendingFileRecord || !pendingRows) return;

    showProgress(true, '正在覆盖文件...', 50);
    try {
      // Find existing file by hash
      var existing = await db.getFileByHash(pendingFileRecord.file_hash);
      if (existing) {
        await db.updateFile(existing.id, pendingFileRecord, pendingRows);
      } else {
        // Rare case: file deleted between check and now
        await db.saveFile(pendingFileRecord, pendingRows);
      }

      showProgress(true, '完成！', 100);
      await sleep(300);
      showProgress(false);

      showToast('✅ 已覆盖：' + pendingFileRecord.row_count + ' 行 / ' + pendingFileRecord.cat_count + ' 分类', 'success');
      await refreshAll();
    } catch (err) {
      showProgress(false);
      showToast('覆盖失败：' + (err.message || '未知错误'), 'error');
    }

    pendingFileRecord = null;
    pendingRows = null;
    pendingFileName = null;
  }

  function handleDuplicateSkip() {
    closeDuplicateModal();
    showToast('已跳过重复文件。', 'info');
  }

  // ── Delete ──
  async function executeDelete(fileId, fileName) {
    try {
      await db.deleteFile(fileId);
      showToast('✅ 已删除：' + fileName, 'success');
      await refreshAll();
    } catch (err) {
      console.error('Delete error:', err);
      showToast('删除失败：' + (err.message || '未知错误'), 'error');
    }
  }

  // ── Update ──
  function triggerUpdateFile(fileId) {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx,.xls';
    input.addEventListener('change', async function () {
      var file = input.files[0];
      if (!file) return;

      var name = file.name.toLowerCase();
      if (!name.endsWith('.xlsx') && !name.endsWith('.xls')) {
        showToast('请上传 .xlsx 或 .xls 格式的文件。', 'warning');
        return;
      }

      showProgress(true, '正在更新文件...');
      try {
        var arrayBuffer = await readFileAsArrayBuffer(file);
        var result = parseExcel(arrayBuffer, file.name);
        if (!result || result.rows.length === 0) {
          showToast('文件为空，未解析到任何数据行。', 'warning');
          showProgress(false);
          return;
        }

        showProgress(true, '正在计算文件指纹...', 40);
        var hash = await computeHash(arrayBuffer);
        result.fileRecord.file_hash = hash;

        showProgress(true, '正在保存...', 70);
        await db.updateFile(fileId, result.fileRecord, result.rows);

        showProgress(true, '完成！', 100);
        await sleep(300);
        showProgress(false);

        showToast('✅ 更新成功：' + result.rows.length + ' 行 / ' + result.fileRecord.cat_count + ' 分类', 'success');
        await refreshAll();
      } catch (err) {
        showProgress(false);
        showToast('更新失败：' + (err.message || '未知错误'), 'error');
      }
    });
    input.click();
  }

  // ── Export ──
  async function exportFileToExcel(fileId, fileName) {
    try {
      var rows = await db.exportFile(fileId);
      if (rows.length === 0) {
        showToast('该文件没有数据可导出。', 'warning');
        return;
      }

      // Reconstruct Excel structure: category rows → header → data
      var exportData = [];
      var lastCategory = '';
      var lastHeader = null;

      for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        if (row.category !== lastCategory) {
          // Add category row
          exportData.push([row.category]);
          lastCategory = row.category;
          lastHeader = null;
        }
        if (!lastHeader || !arraysEqual(lastHeader, row.header_data)) {
          // Add header row
          exportData.push(row.header_data.slice());
          lastHeader = row.header_data.slice();
        }
        exportData.push(row.row_data.slice());
      }

      var ws = XLSX.utils.aoa_to_sheet(exportData);
      var wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '报价数据');

      // Use writeFile for download
      var exportName = fileName.replace(/\.(xlsx?|xls)$/i, '') + '_导出.xlsx';
      XLSX.writeFile(wb, exportName);

      showToast('📥 导出成功：' + rows.length + ' 行数据', 'success');
    } catch (err) {
      console.error('Export error:', err);
      showToast('导出失败：' + (err.message || '未知错误'), 'error');
    }
  }

  function arraysEqual(a, b) {
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  // ── Confirm Modal ──
  function showConfirmModal(message, callback) {
    confirmMessage.innerHTML = message;
    confirmModal._callback = callback;
    confirmModal.classList.add('visible');
  }

  function closeConfirmModal() {
    confirmModal.classList.remove('visible');
    confirmModal._callback = null;
  }

  // ── Progress ──
  function showProgress(visible, text, percent) {
    if (visible) {
      progressDiv.classList.add('visible');
      progressText.textContent = text || '处理中...';
      progressFill.style.width = (percent || 0) + '%';
    } else {
      progressDiv.classList.remove('visible');
      progressFill.style.width = '0%';
    }
  }

  // ── Toast ──
  function showToast(message, type, duration) {
    type = type || 'info';
    duration = duration || 3000;
    var container = document.getElementById('toast-container');

    var toast = document.createElement('div');
    toast.className = 'toast ' + type;

    var iconMap = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
    var icon = document.createElement('span');
    icon.className = 'toast-icon';
    icon.textContent = iconMap[type] || 'ℹ️';
    toast.appendChild(icon);

    var msg = document.createElement('span');
    msg.className = 'toast-message';
    msg.textContent = message;
    toast.appendChild(msg);

    container.appendChild(toast);

    setTimeout(function () {
      toast.classList.add('removing');
      setTimeout(function () {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 250);
    }, duration);
  }

  // ── Utilities ──
  function escapeHtml(str) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }

  function formatTime(isoStr) {
    if (!isoStr) return '-';
    var d = new Date(isoStr);
    if (isNaN(d.getTime())) return isoStr;
    var pad = function (n) { return n < 10 ? '0' + n : n; };
    return (
      d.getFullYear() +
      '-' +
      pad(d.getMonth() + 1) +
      '-' +
      pad(d.getDate()) +
      ' ' +
      pad(d.getHours()) +
      ':' +
      pad(d.getMinutes())
    );
  }

  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  // ── Public API ──
  return { init: init };
})();
