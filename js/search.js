/* ============================================================
   search.js — 搜索逻辑、结果渲染、弹窗、文件筛选
   ============================================================ */

window.SearchApp = (function () {
  // ── DOM References ──
  var searchInput, searchBtn;
  var fileFilters, filterPills, toggleAllBtn;
  var resultsSummary, resultsCount;
  var resultsContainer;
  var emptyState, emptyTitle, emptyDesc, emptyAction;
  var noFilesHint;
  var cellModal, cellModalTitle, cellFullText;

  // State
  var currentQuery = '';
  var selectedFileIds = []; // [] means "all files"
  var allFileIds = [];

  // ── Initialization ──
  async function init() {
    cacheDom();
    bindEvents();

    try {
      await db.init();
      await db.loadCache();
    } catch (err) {
      console.error('db.init() failed:', err);
      showEmptyState('数据库初始化失败', '请检查浏览器是否支持 IndexedDB。', false);
      return;
    }

    await loadFileFilters();

    // Focus search input
    searchInput.focus();
  }

  function cacheDom() {
    searchInput = document.getElementById('search-input');
    searchBtn = document.getElementById('search-btn');
    fileFilters = document.getElementById('file-filters');
    filterPills = document.getElementById('filter-pills');
    toggleAllBtn = document.getElementById('toggle-all');
    resultsSummary = document.getElementById('results-summary');
    resultsCount = document.getElementById('results-count');
    resultsContainer = document.getElementById('results-container');
    emptyState = document.getElementById('empty-state');
    emptyTitle = document.getElementById('empty-title');
    emptyDesc = document.getElementById('empty-desc');
    emptyAction = document.getElementById('empty-action');
    noFilesHint = document.getElementById('no-files-hint');

    cellModal = document.getElementById('cell-modal');
    cellModalTitle = document.getElementById('cell-modal-title');
    cellFullText = document.getElementById('cell-full-text');
  }

  function bindEvents() {
    // Search button
    searchBtn.addEventListener('click', function () {
      doSearch();
    });

    // Enter key in search input
    searchInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        doSearch();
      }
    });

    // Toggle all file filters
    toggleAllBtn.addEventListener('click', function () {
      var allChecked = selectedFileIds.length === 0 || selectedFileIds.length === allFileIds.length;
      if (allChecked) {
        // Uncheck all
        var pills = filterPills.querySelectorAll('.filter-pill input');
        for (var i = 0; i < pills.length; i++) {
          pills[i].checked = false;
        }
        selectedFileIds = [];
      } else {
        // Check all
        var pills2 = filterPills.querySelectorAll('.filter-pill input');
        for (var i = 0; i < pills2.length; i++) {
          pills2[i].checked = true;
        }
        selectedFileIds = [];
      }
      if (currentQuery) doSearch();
    });

    // Cell modal close
    document.getElementById('cell-modal-close').addEventListener('click', closeCellModal);
    document.getElementById('cell-modal-btn-close').addEventListener('click', closeCellModal);
    cellModal.addEventListener('click', function (e) {
      if (e.target === cellModal) closeCellModal();
    });

    // Escape key to close modal
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (cellModal.classList.contains('visible')) {
          closeCellModal();
        }
      }
    });
  }

  // ── File Filters ──
  async function loadFileFilters() {
    try {
      var files = await db.getFiles();
      allFileIds = files.map(function (f) { return f.id; });

      if (files.length === 0) {
        fileFilters.style.display = 'none';
        noFilesHint.style.display = 'block';
        return;
      }

      fileFilters.style.display = 'flex';
      noFilesHint.style.display = 'none';
      filterPills.innerHTML = '';

      for (var i = 0; i < files.length; i++) {
        var f = files[i];
        var label = document.createElement('label');
        label.className = 'filter-pill';

        var checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = f.id;
        checkbox.checked = true;
        checkbox.addEventListener('change', function () {
          updateSelectedFileIds();
          if (currentQuery) doSearch();
        });

        var span = document.createElement('span');
        span.className = 'pill-text';
        span.textContent = f.file_name;

        label.appendChild(checkbox);
        label.appendChild(span);
        filterPills.appendChild(label);
      }

      selectedFileIds = [];
    } catch (err) {
      console.error('loadFileFilters error:', err);
    }
  }

  function updateSelectedFileIds() {
    var checked = filterPills.querySelectorAll('.filter-pill input:checked');
    if (checked.length === allFileIds.length) {
      selectedFileIds = [];
    } else {
      selectedFileIds = [];
      for (var i = 0; i < checked.length; i++) {
        selectedFileIds.push(Number(checked[i].value));
      }
    }
  }

  // ── Search ──
  async function doSearch() {
    var query = searchInput.value.trim();
    if (!query) return;

    currentQuery = query;

    // Check files exist
    if (allFileIds.length === 0) {
      showEmptyState('还没有上传报价文件', '请先前往管理后台上传报价文件。', true);
      hideResults();
      return;
    }

    // Check at least one file selected
    updateSelectedFileIds();
    var effectiveFileIds = selectedFileIds.length === 0 ? allFileIds : selectedFileIds;
    if (effectiveFileIds.length === 0) {
      showEmptyState('请至少选择一个文件', '请在筛选条件中勾选要搜索的文件。', false);
      hideResults();
      return;
    }

    // Disable search during operation
    searchBtn.disabled = true;
    searchBtn.textContent = '搜索中...';

    try {
      // Search in memory cache (single synchronous call)
      var allResults = db.searchInMemory(query, effectiveFileIds);

      if (allResults.length === 0) {
        showEmptyState('未找到匹配结果', '未找到匹配 "' + query + '" 的结果。', false);
        hideResults();
      } else {
        var grouped = groupResults(allResults, query);
        hideEmptyState();
        renderResults(grouped, query);
      }
    } catch (err) {
      console.error('Search error:', err);
      showToast('搜索出错：' + (err.message || '未知错误'), 'error');
    }

    searchBtn.disabled = false;
    searchBtn.textContent = '搜索';
  }

  // ── Group Results ──
  function groupResults(rows, query) {
    // Sort rows for consistent output
    rows.sort(function (a, b) {
      if (a.file_name !== b.file_name) return a.file_name.localeCompare(b.file_name);
      if (a.category_order !== b.category_order) return a.category_order - b.category_order;
      return a.row_order - b.row_order;
    });

    var resultMap = {};

    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var fileName = row.file_name || '未知文件';
      var category = row.category || '未分类';

      if (!resultMap[fileName]) {
        resultMap[fileName] = {};
      }
      if (!resultMap[fileName][category]) {
        resultMap[fileName][category] = {
          category: category,
          category_order: row.category_order,
          header_data: row.header_data || [],
          rows: [],
        };
      }
      resultMap[fileName][category].rows.push(row);
    }

    return resultMap;
  }

  // ── Render Results ──
  function renderResults(grouped, query) {
    var totalHits = 0;
    var fileNames = Object.keys(grouped).sort();

    // Calculate total
    for (var fn = 0; fn < fileNames.length; fn++) {
      var categories = grouped[fileNames[fn]];
      var catNames = Object.keys(categories);
      for (var cn = 0; cn < catNames.length; cn++) {
        totalHits += categories[catNames[cn]].rows.length;
      }
    }

    // Show summary
    resultsSummary.style.display = 'block';
    resultsCount.innerHTML = '共找到 <strong>' + totalHits + '</strong> 条结果';

    // Build result panels
    resultsContainer.innerHTML = '';

    for (var i = 0; i < fileNames.length; i++) {
      var fileName = fileNames[i];
      var catMap = grouped[fileName];
      var catNames = Object.keys(catMap).sort(function (a, b) {
        return catMap[a].category_order - catMap[b].category_order;
      });

      var fileHits = 0;
      for (var j = 0; j < catNames.length; j++) {
        fileHits += catMap[catNames[j]].rows.length;
      }

      var filePanel = createFilePanel(fileName, catMap, catNames, query, fileHits);
      resultsContainer.appendChild(filePanel);

      // Expand first file panel by default
      if (i === 0 && filePanel._expandOnMount) {
        var header = filePanel.querySelector('.result-file-header');
        var body = filePanel.querySelector('.result-file-body');
        var icon = header.querySelector('.toggle-icon');
        body.classList.add('expanded');
        icon.classList.add('expanded');
      }
    }
  }

  function createFilePanel(fileName, catMap, catNames, query, totalHits) {
    var panel = document.createElement('div');
    panel.className = 'result-file';

    // Header
    var header = document.createElement('div');
    header.className = 'result-file-header';
    header.innerHTML =
      '<span class="toggle-icon">▶</span>' +
      '<span class="file-icon">📁</span>' +
      '<span class="file-name">' +
      escapeHtml(fileName) +
      '</span>' +
      '<span class="file-count">' +
      totalHits +
      ' 条</span>';

    // Body
    var body = document.createElement('div');
    body.className = 'result-file-body';

    for (var i = 0; i < catNames.length; i++) {
      var catName = catNames[i];
      var catData = catMap[catName];
      var catPanel = createCategoryPanel(catName, catData, query);
      body.appendChild(catPanel);
    }

    // Toggle on click
    header.addEventListener('click', function () {
      var icon = header.querySelector('.toggle-icon');
      var isExpanded = body.classList.contains('expanded');
      if (isExpanded) {
        body.classList.remove('expanded');
        icon.classList.remove('expanded');
      } else {
        body.classList.add('expanded');
        icon.classList.add('expanded');
      }
    });

    // Default: first file expanded
    if (catNames.length > 0) {
      // Expand the first file by default — mark after append
      panel._expandOnMount = true;
    }

    panel.appendChild(header);
    panel.appendChild(body);
    return panel;
  }

  function createCategoryPanel(catName, catData, query) {
    var panel = document.createElement('div');
    panel.className = 'result-category';

    // Header
    var header = document.createElement('div');
    header.className = 'result-category-header';
    header.innerHTML =
      '<span class="toggle-icon">▶</span>' +
      '<span class="category-name">' +
      escapeHtml(catName) +
      '</span>' +
      '<span class="category-count">' +
      catData.rows.length +
      ' 行</span>';

    // Body
    var body = document.createElement('div');
    body.className = 'result-category-body';

    // Build table (lazily — we build it now but it's hidden until expand)
    var tableWrapper = document.createElement('div');
    tableWrapper.className = 'table-wrapper';
    var table = buildDataTable(catData.header_data, catData.rows, query);
    tableWrapper.appendChild(table);
    body.appendChild(tableWrapper);

    // Toggle on click
    header.addEventListener('click', function () {
      var icon = header.querySelector('.toggle-icon');
      var isExpanded = body.classList.contains('expanded');
      if (isExpanded) {
        body.classList.remove('expanded');
        icon.classList.remove('expanded');
      } else {
        body.classList.add('expanded');
        icon.classList.add('expanded');
      }
    });

    panel.appendChild(header);
    panel.appendChild(body);
    return panel;
  }

  function buildDataTable(headerData, rows, query) {
    var table = document.createElement('table');
    table.className = 'data-table';

    // thead
    var thead = document.createElement('thead');
    var headerRow = document.createElement('tr');

    for (var i = 0; i < headerData.length; i++) {
      var th = document.createElement('th');
      th.textContent = headerData[i] || '列' + (i + 1);
      headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);

    // tbody
    var tbody = document.createElement('tbody');

    for (var r = 0; r < rows.length; r++) {
      var row = rows[r];
      var tr = document.createElement('tr');

      for (var c = 0; c < headerData.length; c++) {
        var td = document.createElement('td');
        var cellValue = row.row_data && c < row.row_data.length ? row.row_data[c] : '';
        var cellStr = cellValue != null ? String(cellValue) : '';

        // Highlight match
        var highlighted = highlightMatch(cellStr, query);

        // Truncate long text
        var formatted = formatCellText(highlighted, cellStr, 30, headerData[c] || '列' + (c + 1));

        td.innerHTML = formatted;

        // Bind double-click for truncated cells
        if (cellStr.length > 30) {
          td.addEventListener('dblclick', function (colName, fullText) {
            return function () {
              showCellDetail(colName, fullText);
            };
          }(headerData[c] || '列' + (c + 1), cellStr));
        }

        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);

    return table;
  }

  // ── Highlight Match ──
  function highlightMatch(text, query) {
    if (!query || !text) return escapeHtml(text);

    var escapedText = escapeHtml(text);
    var lowerText = text.toLowerCase();
    var lowerQuery = query.toLowerCase();
    var idx = lowerText.indexOf(lowerQuery);

    if (idx === -1) return escapedText;

    // Since text is escaped, we need to find the match position in escaped version
    // Simple approach: use the original text positions (works for most cases)
    var before = escapedText.substring(0, idx);
    var match = escapedText.substring(idx, idx + query.length);
    var after = escapedText.substring(idx + query.length);

    return before + '<span class="highlight">' + match + '</span>' + after;
  }

  // ── Format Cell Text (Truncation) ──
  function formatCellText(highlightedHtml, originalText, maxLen, columnName) {
    if (originalText.length <= maxLen) return highlightedHtml;

    // Truncate: show first maxLen chars + ...🔍
    var truncated = originalText.substring(0, maxLen);

    // Create truncated display with the same highlight
    var lowerText = originalText.toLowerCase();
    var lowerQuery = currentQuery ? currentQuery.toLowerCase() : '';

    var displayHtml;
    if (lowerQuery && lowerText.indexOf(lowerQuery) !== -1) {
      // Highlight in truncated
      displayHtml = highlightMatch(truncated, currentQuery);
    } else {
      displayHtml = escapeHtml(truncated);
    }

    return (
      '<span class="cell-truncated" title="双击查看完整内容" data-column="' +
      escapeHtml(columnName) +
      '" data-full="' +
      escapeHtml(originalText).replace(/"/g, '&quot;') +
      '">' +
      displayHtml +
      '…</span>'
    );
  }

  // ── Cell Detail Modal ──
  function showCellDetail(columnName, fullText) {
    cellModalTitle.textContent = columnName;
    cellFullText.textContent = fullText;
    cellModal.classList.add('visible');
  }

  function closeCellModal() {
    cellModal.classList.remove('visible');
  }

  // ── Empty State ──
  function showEmptyState(title, desc, showAction) {
    emptyState.style.display = 'block';
    emptyTitle.textContent = title;
    emptyDesc.textContent = desc;
    if (showAction) {
      emptyAction.style.display = 'inline-flex';
    } else {
      emptyAction.style.display = 'none';
    }
  }

  function hideEmptyState() {
    emptyState.style.display = 'none';
  }

  function hideResults() {
    resultsSummary.style.display = 'none';
    resultsContainer.innerHTML = '';
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

  // ── Public API ──
  return { init: init };
})();
