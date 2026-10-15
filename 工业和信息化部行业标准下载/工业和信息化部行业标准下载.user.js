// ==UserScript==
// @name         工业和信息化部行业标准全文下载
// @name:en      MIIT Industry Standard Full Text Downloader
// @namespace    https://github.com/Augenstern-O
// @version      1.0
// @description  在工业和信息化部行业标准全文列表的预览按钮下方添加下载按钮。
// @description:en Add a download button below preview buttons on the MIIT industry standard full text list.
// @author       Augenstern-O
// @icon         https://std.miit.gov.cn/favicon.ico
// @license      LGPL-3.0
// @match        https://std.miit.gov.cn/*
// @connect      uip.cesa.cn
// @connect      *.cesa.cn
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  var API_URL = 'https://uip.cesa.cn/api/fileManage/Param';
  var MARK = 'cesaDownloadAdded';
  var PREVIEW_TEXT = '预览';
  var DOWNLOAD_TEXT = '下载';
  var DOWNLOADING_TEXT = '下载中...';
  var DONE_TEXT = '已获取';
  var STANDARD_NO_RE = /[A-Z]{1,5}(?:\/[A-Z])?\/T\s*\d+(?:\.\d+)?-\d{4}/i;
  var capturedParams = [];
  var pendingPreviewCapture = null;

  function normalizeStandardNo(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function getText(node) {
    return normalizeStandardNo(node ? node.textContent : '');
  }

  function sanitizeFilename(value) {
    var name = normalizeStandardNo(value)
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\.+$/g, '')
      .trim();
    return name || 'standard';
  }

  function getRowInfo(previewButton) {
    var row = previewButton.closest('tr');
    var cells;
    var standardNo = '';
    var standardName = '';

    if (row) {
      cells = row.querySelectorAll('td');
      if (cells[1]) {
        standardNo = normalizeStandardNo(
          (cells[1].querySelector('[title]') || {}).title || getText(cells[1])
        );
      }
      if (cells[2]) {
        standardName = normalizeStandardNo(
          (cells[2].querySelector('[title]') || {}).title || getText(cells[2])
        );
      }
    }

    return {
      standardNo: standardNo,
      standardName: standardName
    };
  }

  function getCellText(cell) {
    var titleNode = cell ? cell.querySelector('[title]') : null;
    return normalizeStandardNo((titleNode && titleNode.title) || getText(cell));
  }

  function sameStandardNo(left, right) {
    return normalizeStandardNo(left).toUpperCase() === normalizeStandardNo(right).toUpperCase();
  }

  function findRowInfoByStandardNo(standardNo) {
    var rows;
    var found = {
      standardNo: '',
      standardName: ''
    };

    if (!standardNo) {
      return found;
    }

    rows = document.querySelectorAll('tr.el-table__row, tr');
    Array.prototype.some.call(rows, function (row) {
      var cells = row.querySelectorAll('td');
      var rowStandardNo;

      if (cells.length < 3) {
        return false;
      }

      rowStandardNo = getCellText(cells[1]);
      if (!sameStandardNo(rowStandardNo, standardNo)) {
        return false;
      }

      found.standardNo = rowStandardNo;
      found.standardName = getCellText(cells[2]);
      return Boolean(found.standardName);
    });

    return found;
  }

  function safeDecode(value) {
    try {
      return decodeURIComponent(value);
    } catch (error) {
      return value;
    }
  }

  function getDatasetText(node) {
    var values = [];
    var dataset = node && node.dataset ? node.dataset : {};
    Object.keys(dataset).forEach(function (key) {
      values.push(dataset[key]);
    });
    return values.join(' ');
  }

  function findStandardNo(previewButton) {
    var rowInfo = getRowInfo(previewButton);
    var raw = [
      rowInfo.standardNo,
      previewButton.getAttribute('onclick'),
      previewButton.getAttribute('href'),
      getDatasetText(previewButton),
      getText(previewButton.closest('tr')),
      getText(previewButton.closest('.el-table__row')),
      getText(previewButton.closest('[class*="table-row"]')),
      getText(previewButton.closest('[class*="list-item"]')),
      getText(previewButton.closest('li')),
      getText(previewButton.parentElement)
    ].filter(Boolean).join(' ');

    var bzNoParam = raw.match(/[?&]bzNo=([^&"' )]+)/i);
    if (bzNoParam) {
      return normalizeStandardNo(safeDecode(bzNoParam[1]));
    }

    var match = safeDecode(raw.replace(/\+/g, ' ')).match(STANDARD_NO_RE);
    return match ? normalizeStandardNo(match[0]) : '';
  }

  function getUrl(value) {
    if (!value) {
      return '';
    }
    if (typeof value === 'string') {
      return value;
    }
    if (value.url) {
      return value.url;
    }
    return String(value);
  }

  function getBzNoFromUrl(url) {
    var match = String(url || '').match(/[?&]bzNo=([^&]+)/i);
    return match ? normalizeStandardNo(safeDecode(match[1].replace(/\+/g, ' '))) : '';
  }

  function parseJsonMaybe(text) {
    if (!text) {
      return null;
    }
    try {
      return typeof text === 'string' ? JSON.parse(text) : text;
    } catch (error) {
      return null;
    }
  }

  function rememberParam(url, data) {
    var bzNo = getBzNoFromUrl(url);
    var item;

    if (!url || url.indexOf('/api/fileManage/Param') === -1) {
      return;
    }

    item = {
      bzNo: bzNo,
      data: data || null,
      time: Date.now(),
      url: url
    };
    capturedParams.push(item);
    if (capturedParams.length > 20) {
      capturedParams.shift();
    }

    if (pendingPreviewCapture && data && data.code === '0' && data.path) {
      pendingPreviewCapture.resolve(item);
      pendingPreviewCapture = null;
    }
  }

  function hookPageRequests() {
    var win = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    var rawFetch = win.fetch;
    var rawOpen = win.XMLHttpRequest && win.XMLHttpRequest.prototype.open;
    var rawSend = win.XMLHttpRequest && win.XMLHttpRequest.prototype.send;

    if (rawFetch && !rawFetch.__cesaDownloadHooked) {
      win.fetch = function () {
        var url = getUrl(arguments[0]);
        var result = rawFetch.apply(this, arguments);

        if (url.indexOf('/api/fileManage/Param') !== -1) {
          result.then(function (response) {
            response.clone().text().then(function (text) {
              rememberParam(url, parseJsonMaybe(text));
            }).catch(function () {
              rememberParam(url, null);
            });
          }).catch(function () {});
        }

        return result;
      };
      win.fetch.__cesaDownloadHooked = true;
    }

    if (rawOpen && rawSend && !win.XMLHttpRequest.prototype.__cesaDownloadHooked) {
      win.XMLHttpRequest.prototype.open = function (method, url) {
        this.__cesaDownloadUrl = getUrl(url);
        return rawOpen.apply(this, arguments);
      };
      win.XMLHttpRequest.prototype.send = function () {
        var xhr = this;
        if (xhr.__cesaDownloadUrl && xhr.__cesaDownloadUrl.indexOf('/api/fileManage/Param') !== -1) {
          xhr.addEventListener('load', function () {
            rememberParam(xhr.__cesaDownloadUrl, parseJsonMaybe(xhr.responseText));
          });
        }
        return rawSend.apply(this, arguments);
      };
      win.XMLHttpRequest.prototype.__cesaDownloadHooked = true;
    }
  }

  function request(options) {
    return new Promise(function (resolve, reject) {
      GM_xmlhttpRequest({
        method: options.method || 'GET',
        url: options.url,
        responseType: options.responseType,
        anonymous: false,
        timeout: 60000,
        onload: function (res) {
          if (res.status >= 200 && res.status < 300) {
            resolve(res);
            return;
          }
          reject(new Error('HTTP ' + res.status));
        },
        ontimeout: function () {
          reject(new Error('Request timeout'));
        },
        onerror: function () {
          reject(new Error('Network request failed'));
        }
      });
    });
  }

  function getPdfBlob(bzNo) {
    var paramUrl = API_URL + '?bzNo=' + encodeURIComponent(bzNo);

    return request({ url: paramUrl, responseType: 'json' }).then(function (paramRes) {
      var data = typeof paramRes.response === 'string'
        ? JSON.parse(paramRes.response)
        : paramRes.response;

      if (!data || data.code !== '0' || !data.path) {
        throw new Error('No preview file for this standard');
      }

      return request({ url: data.path, responseType: 'blob' });
    }).then(function (pdfRes) {
      return pdfRes.response;
    });
  }

  function getPdfBlobByPath(path) {
    return request({ url: path, responseType: 'blob' }).then(function (pdfRes) {
      return pdfRes.response;
    });
  }

  function getPdfFromPreviewClick(previewButton) {
    return new Promise(function (resolve, reject) {
      var timer;

      pendingPreviewCapture = {
        resolve: function (item) {
          clearTimeout(timer);
          resolve(item);
        }
      };

      timer = setTimeout(function () {
        pendingPreviewCapture = null;
        reject(new Error('Preview request was not captured'));
      }, 12000);

      previewButton.click();
    }).then(function (item) {
      return getPdfBlobByPath(item.data.path).then(function (blob) {
        return {
          blob: blob,
          bzNo: item.bzNo
        };
      });
    });
  }

  function fallbackDownload(url, filename) {
    var link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 30000);
  }

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    fallbackDownload(url, filename);
  }

  function handleDownload(button, previewButton) {
    var rowInfo = getRowInfo(previewButton);
    var bzNo = rowInfo.standardNo || findStandardNo(previewButton);
    var originalText = button.textContent;
    var preferredName = rowInfo.standardName || rowInfo.standardNo;

    button.disabled = true;
    button.textContent = DOWNLOADING_TEXT;

    (bzNo ? getPdfBlob(bzNo) : Promise.reject(new Error('找不到标准号'))).then(function (blob) {
      return {
        blob: blob,
        bzNo: bzNo
      };
    }).catch(function () {
      return getPdfFromPreviewClick(previewButton);
    }).then(function (result) {
      var latestRowInfo = findRowInfoByStandardNo(result.bzNo || bzNo);
      var filenameStandardNo = latestRowInfo.standardNo || result.bzNo || bzNo || '';
      var filenameStandardName = latestRowInfo.standardName || preferredName || '';
      var filenameBase = normalizeStandardNo((filenameStandardNo + ' ' + filenameStandardName).trim())
        || filenameStandardNo
        || filenameStandardName
        || 'standard';
      var filename = sanitizeFilename(filenameBase) + '.pdf';
      downloadBlob(result.blob, filename);
      button.textContent = DONE_TEXT;
      setTimeout(function () {
        button.textContent = originalText;
        button.disabled = false;
      }, 1500);
    }).catch(function (error) {
      alert(error && error.message ? error.message : '下载失败');
      button.textContent = originalText;
      button.disabled = false;
    });
  }

  function isPreviewButton(node) {
    var text;
    if (!(node instanceof HTMLElement)) {
      return false;
    }
    text = getText(node);
    return text === PREVIEW_TEXT;
  }

  function createDownloadButton(previewButton) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = previewButton.className || 'el-button tag-btn';
    button.textContent = DOWNLOAD_TEXT;
    button.style.marginLeft = '0';
    button.style.cursor = 'pointer';
    button.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      handleDownload(button, previewButton);
    });
    return button;
  }

  function addDownloadButtons() {
    var candidates = document.querySelectorAll('button, a, [role="button"]');
    Array.prototype.forEach.call(candidates, function (node) {
      if (!isPreviewButton(node) || node.dataset[MARK]) {
        return;
      }

      node.dataset[MARK] = '1';
      alignActionCell(node);
      node.insertAdjacentElement('afterend', createDownloadButton(node));
    });
  }

  function alignActionCell(previewButton) {
    var cell = previewButton.closest('.cell');
    var parent = previewButton.parentElement;

    if (cell) {
      cell.style.display = 'flex';
      cell.style.flexDirection = 'column';
      cell.style.alignItems = 'center';
      cell.style.justifyContent = 'center';
      cell.style.gap = '6px';
    }

    if (parent) {
      parent.style.display = 'inline-flex';
      parent.style.flexDirection = 'column';
      parent.style.alignItems = 'center';
      parent.style.justifyContent = 'center';
      parent.style.gap = '6px';
    }
  }

  function removeCaptchaDialog() {
    var dialogs = document.querySelectorAll('.el-overlay-dialog, .el-dialog');
    var removed = false;
    Array.prototype.forEach.call(dialogs, function (dialog) {
      var title = getText(dialog.querySelector('.el-dialog__header'));
      var target = dialog.classList.contains('el-overlay-dialog') ? dialog : dialog.closest('.el-overlay-dialog');

      if (title.indexOf('验证码校验') === -1) {
        return;
      }

      if (target) {
        target.remove();
        removed = true;
        return;
      }

      dialog.remove();
      removed = true;
    });

    if (removed) {
      removeTopModalOverlay();
    }
  }

  function removeTopModalOverlay() {
    var overlays = document.querySelectorAll('.el-overlay.el-modal-dialog');
    var topOverlay = null;
    var topZIndex = -1;

    Array.prototype.forEach.call(overlays, function (overlay) {
      var zIndex = Number(overlay.style.zIndex || window.getComputedStyle(overlay).zIndex || 0);
      if (zIndex >= topZIndex) {
        topZIndex = zIndex;
        topOverlay = overlay;
      }
    });

    if (topOverlay) {
      topOverlay.remove();
    }
  }

  hookPageRequests();
  addDownloadButtons();
  removeCaptchaDialog();

  new MutationObserver(function () {
    addDownloadButtons();
    removeCaptchaDialog();
  }).observe(document.body, {
    childList: true,
    subtree: true
  });
}());
