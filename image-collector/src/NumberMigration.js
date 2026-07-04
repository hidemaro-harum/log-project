var NUMBER_MAPPING_HEADERS_ = [
  '商品管理番号（商品URL）', '旧商品番号', '新商品番号',
  '旧システム連携用SKU番号', '新システム連携用SKU番号',
  'SKU区分', '備考', '検証結果'
];
var NUMBER_MIGRATION_MAX_NUMBER_LENGTH_ = 32;
var NUMBER_MAPPING_RAKUTEN_SKIP_MARKER_ = '[楽天CSV対象外]';
var RAKUTEN_NUMBER_MIGRATION_REQUIRED_HEADERS_ = [
  '商品管理番号（商品URL）', '商品番号', '選択肢タイプ',
  'SKU管理番号', 'システム連携用SKU番号'
];

function numberText_(value) {
  return value == null ? '' : String(value).trim();
}

function numberKey_(value) {
  return numberText_(value).toLowerCase();
}

function hasRakutenSkipMarker_(value) {
  return numberText_(value).indexOf(NUMBER_MAPPING_RAKUTEN_SKIP_MARKER_) !== -1;
}

function addRakutenSkipMarker_(value) {
  var note = numberText_(value);
  if (hasRakutenSkipMarker_(note)) return note;
  return note ? note + '\n' + NUMBER_MAPPING_RAKUTEN_SKIP_MARKER_ : NUMBER_MAPPING_RAKUTEN_SKIP_MARKER_;
}

function removeRakutenSkipMarker_(value) {
  return numberText_(value)
    .replace(NUMBER_MAPPING_RAKUTEN_SKIP_MARKER_, '')
    .replace(/^\s+|\s+$/g, '');
}

function utf8ByteLengthNm_(value) {
  var text = numberText_(value);
  var bytes = 0;
  for (var i = 0; i < text.length; i++) {
    var code = text.charCodeAt(i);
    if (code <= 0x7F) bytes += 1;
    else if (code <= 0x7FF) bytes += 2;
    else if (code >= 0xD800 && code <= 0xDBFF &&
             i + 1 < text.length &&
             text.charCodeAt(i + 1) >= 0xDC00 && text.charCodeAt(i + 1) <= 0xDFFF) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}

function headerMapNm_(headers) {
  var map = {};
  headers.forEach(function(header, index) {
    map[numberText_(header)] = index;
  });
  return map;
}

function parseNumberMapping_(data) {
  var result = { errors: [], warnings: [], rows: [], byUrl: {}, byOldSku: {}, byNewSku: {} };
  if (!data || data.length < 2) {
    result.errors.push('対照表にデータがありません');
    return result;
  }

  var headerMap = headerMapNm_(data[0]);
  NUMBER_MAPPING_HEADERS_.slice(0, 6).forEach(function(header) {
    if (headerMap[header] === undefined) result.errors.push('必須ヘッダー不足: ' + header);
  });
  if (result.errors.length) return result;

  var oldItemOwners = {};
  var newItemOwners = {};
  for (var i = 1; i < data.length; i++) {
    var source = data[i] || [];
    var hasMappingInput = NUMBER_MAPPING_HEADERS_.slice(0, 6).some(function(header) {
      return numberText_(source[headerMap[header]]) !== '';
    });
    if (!hasMappingInput) continue;

    var row = {
      sheetRow: i + 1,
      url: numberText_(source[headerMap[NUMBER_MAPPING_HEADERS_[0]]]),
      oldItem: numberText_(source[headerMap[NUMBER_MAPPING_HEADERS_[1]]]),
      newItem: numberText_(source[headerMap[NUMBER_MAPPING_HEADERS_[2]]]),
      oldSku: numberText_(source[headerMap[NUMBER_MAPPING_HEADERS_[3]]]),
      newSku: numberText_(source[headerMap[NUMBER_MAPPING_HEADERS_[4]]]),
      type: numberText_(source[headerMap[NUMBER_MAPPING_HEADERS_[5]]]),
      note: headerMap['備考'] === undefined ? '' : numberText_(source[headerMap['備考']])
    };
    row.skipRakuten = hasRakutenSkipMarker_(row.note);
    var missing = [];
    var requiredKeys = row.skipRakuten ?
      ['oldItem', 'newItem', 'oldSku', 'newSku', 'type'] :
      ['url', 'oldItem', 'newItem', 'oldSku', 'newSku', 'type'];
    requiredKeys.forEach(function(key) {
      if (!row[key]) missing.push(key);
    });
    if (missing.length) result.errors.push(row.sheetRow + '行目: 必須値が空欄');
    if (row.skipRakuten) result.warnings.push(row.sheetRow + '行目: 楽天CSV対象外としてスキップ');
    if (row.type !== 'シングル' && row.type !== 'マルチ') {
      result.errors.push(row.sheetRow + '行目: SKU区分が不正');
    }
    ['oldItem', 'newItem', 'oldSku', 'newSku'].forEach(function(key) {
      if (utf8ByteLengthNm_(row[key]) > NUMBER_MIGRATION_MAX_NUMBER_LENGTH_) {
        result.errors.push(row.sheetRow + '行目: ' + key + 'は32バイト以内（半角32文字以内）にしてください');
      }
    });
    if (row.type === 'シングル' &&
        (numberKey_(row.oldItem) !== numberKey_(row.oldSku) ||
         numberKey_(row.newItem) !== numberKey_(row.newSku))) {
      result.errors.push(row.sheetRow + '行目: シングルSKUは商品番号と連携番号を一致させてください');
    }

    var urlKey = numberKey_(row.url);
    var oldSkuKey = numberKey_(row.oldSku);
    var newSkuKey = numberKey_(row.newSku);
    if (oldSkuKey) {
      if (result.byOldSku[oldSkuKey]) result.errors.push(row.sheetRow + '行目: 旧システム連携用SKU番号が重複');
      else result.byOldSku[oldSkuKey] = row;
    }
    if (newSkuKey) {
      if (result.byNewSku[newSkuKey]) result.errors.push(row.sheetRow + '行目: 新システム連携用SKU番号が重複');
      else result.byNewSku[newSkuKey] = row;
    }

    if (urlKey) {
      if (!result.byUrl[urlKey]) {
        result.byUrl[urlKey] = { rows: [], oldItem: row.oldItem, newItem: row.newItem, type: row.type };
      } else if (numberKey_(result.byUrl[urlKey].oldItem) !== numberKey_(row.oldItem) ||
                 numberKey_(result.byUrl[urlKey].newItem) !== numberKey_(row.newItem) ||
                 result.byUrl[urlKey].type !== row.type) {
        result.errors.push(row.sheetRow + '行目: 同一商品の番号または区分が矛盾');
      }
      result.byUrl[urlKey].rows.push(row);
    }
    result.rows.push(row);

    registerProductNumberOwner_(oldItemOwners, row.oldItem, row, '旧商品番号', result.errors);
    registerProductNumberOwner_(newItemOwners, row.newItem, row, '新商品番号', result.errors);
  }

  result.rows.forEach(function(row) {
    var oldSkuKey = numberKey_(row.oldSku);
    var newSkuOwner = oldSkuKey ? result.byNewSku[oldSkuKey] : null;
    if (newSkuOwner && newSkuOwner !== row) {
      result.errors.push(row.sheetRow + '行目: 旧システム連携用SKU番号「' + row.oldSku +
        '」は' + newSkuOwner.sheetRow + '行目の新システム連携用SKU番号と重複し、旧・新を判定できません');
    }
  });

  Object.keys(result.byUrl).forEach(function(key) {
    var group = result.byUrl[key];
    if (group.type === 'マルチ' && group.rows.length < 2) {
      result.errors.push(group.rows[0].sheetRow + '行目: マルチSKUは2行以上必要');
    }
  });
  Object.keys(newItemOwners).forEach(function(key) {
    if (oldItemOwners[key] && oldItemOwners[key].urlKey !== newItemOwners[key].urlKey) {
      result.errors.push(newItemOwners[key].sheetRow + '行目: 新商品番号「' + newItemOwners[key].value + '」が別商品の旧商品番号と衝突');
    }
  });
  if (!result.rows.length) result.errors.push('対照表にデータがありません');
  return result;
}

function registerProductNumberOwner_(owners, value, row, label, errors) {
  var key = numberKey_(value);
  if (!key) return;
  var urlKey = numberKey_(row.url);
  if (owners[key] && owners[key].urlKey !== urlKey) {
    errors.push(row.sheetRow + '行目: ' + label + '「' + value + '」が異なる商品管理番号で重複');
    return;
  }
  if (!owners[key]) owners[key] = { urlKey: urlKey, sheetRow: row.sheetRow, value: value };
}

function requiredNmHeaders_(data, names) {
  var headers = data && data.length ? data[0] : [];
  var map = {};
  var counts = {};
  headers.forEach(function(header, index) {
    var name = numberText_(header);
    counts[name] = (counts[name] || 0) + 1;
    if (map[name] === undefined) map[name] = index;
  });
  var errors = [];
  names.forEach(function(name) {
    if (!counts[name]) errors.push('必須ヘッダー不足: ' + name);
    else if (counts[name] > 1) errors.push('必須ヘッダー重複: ' + name);
  });
  return { map: map, errors: errors };
}

function planNumberMappingAutoFill_(mappingData, rakutenData) {
  var mappingRequired = requiredNmHeaders_(mappingData, [
    '商品管理番号（商品URL）', '旧商品番号', '新商品番号',
    '旧システム連携用SKU番号', '新システム連携用SKU番号', 'SKU区分', '備考'
  ]);
  var rakutenRequired = requiredNmHeaders_(rakutenData, [
    '商品管理番号（商品URL）', '商品番号', '選択肢タイプ',
    'SKU管理番号', 'システム連携用SKU番号'
  ]);
  var plan = {
    changes: [],
    errors: mappingRequired.errors.concat(rakutenRequired.errors),
    warnings: [],
    alreadyFilled: 0,
    skipped: 0,
    targetCount: 0
  };
  if (plan.errors.length) return plan;

  var mappingColumns = mappingRequired.map;
  var rakutenColumns = rakutenRequired.map;
  var skuRowsByNumber = {};
  var skuCountByUrl = {};
  var skuKeysByUrl = {};
  var skuNamesByUrl = {};
  var productNumberByUrl = {};
  var mappingRowByOldSku = {};
  var mappingRowsByRakutenUrl = {};
  var anchorErrorByUrl = {};

  for (var m = 1; m < mappingData.length; m++) {
    var indexedMappingRow = mappingData[m] || [];
    var indexedOldSku = numberKey_(indexedMappingRow[mappingColumns['旧システム連携用SKU番号']]);
    if (indexedOldSku && !mappingRowByOldSku[indexedOldSku]) {
      mappingRowByOldSku[indexedOldSku] = { rowIndex: m, row: indexedMappingRow };
    }
  }

  for (var r = 1; r < rakutenData.length; r++) {
    var rakutenRow = rakutenData[r];
    var skuManagement = numberText_(rakutenRow[rakutenColumns['SKU管理番号']]);
    var optionType = numberText_(rakutenRow[rakutenColumns['選択肢タイプ']]);
    var rakutenUrl = numberText_(rakutenRow[rakutenColumns['商品管理番号（商品URL）']]);
    var rakutenUrlKey = numberKey_(rakutenUrl);
    var productNumber = numberText_(rakutenRow[rakutenColumns['商品番号']]);
    if (rakutenUrlKey && productNumber && !skuManagement && !optionType) {
      productNumberByUrl[rakutenUrlKey] = productNumber;
    }
    if (!skuManagement || optionType) continue;

    var systemSku = numberText_(rakutenRow[rakutenColumns['システム連携用SKU番号']]);
    var skuKey = numberKey_(systemSku);
    if (skuKey) {
      if (!skuRowsByNumber[skuKey]) skuRowsByNumber[skuKey] = [];
      skuRowsByNumber[skuKey].push({ sheetRow: r + 1, url: rakutenUrl, urlKey: rakutenUrlKey });
      if (rakutenUrlKey) {
        if (!skuKeysByUrl[rakutenUrlKey]) skuKeysByUrl[rakutenUrlKey] = {};
        if (!skuNamesByUrl[rakutenUrlKey]) skuNamesByUrl[rakutenUrlKey] = {};
        skuKeysByUrl[rakutenUrlKey][skuKey] = true;
        skuNamesByUrl[rakutenUrlKey][skuKey] = systemSku;
      }
    }
    if (rakutenUrlKey) skuCountByUrl[rakutenUrlKey] = (skuCountByUrl[rakutenUrlKey] || 0) + 1;
  }

  for (var g = 1; g < mappingData.length; g++) {
    var groupedMappingRow = mappingData[g] || [];
    var groupedOldSku = numberKey_(groupedMappingRow[mappingColumns['旧システム連携用SKU番号']]);
    var groupedMatches = skuRowsByNumber[groupedOldSku] || [];
    if (groupedMatches.length !== 1 || !groupedMatches[0].urlKey) continue;
    var groupedUrlKey = groupedMatches[0].urlKey;
    if (!mappingRowsByRakutenUrl[groupedUrlKey]) mappingRowsByRakutenUrl[groupedUrlKey] = [];
    mappingRowsByRakutenUrl[groupedUrlKey].push({
      rowIndex: g,
      row: groupedMappingRow,
      oldSkuKey: groupedOldSku
    });
  }

  var missingSkuErrorByUrl = {};
  Object.keys(mappingRowsByRakutenUrl).forEach(function(urlKey) {
    var groupedEntries = mappingRowsByRakutenUrl[urlKey];
    var mappedSkuKeys = {};
    groupedEntries.forEach(function(entry) { mappedSkuKeys[entry.oldSkuKey] = true; });
    var missingSkuKeys = Object.keys(skuKeysByUrl[urlKey] || {}).filter(function(skuKey) {
      return !mappedSkuKeys[skuKey];
    });
    if (!missingSkuKeys.length) return;

    var missingSkuNames = missingSkuKeys.map(function(skuKey) {
      return skuNamesByUrl[urlKey][skuKey];
    });
    groupedEntries.forEach(function(entry) {
      plan.errors.push((entry.rowIndex + 1) +
        '行目: 同一商品の対照表に楽天CSVのSKUが不足しています: ' + missingSkuNames.join(', '));
    });
    missingSkuErrorByUrl[urlKey] = true;
  });

  for (var i = 1; i < mappingData.length; i++) {
    var mappingRow = mappingData[i] || [];
    var hasInput = NUMBER_MAPPING_HEADERS_.slice(0, 6).some(function(header) {
      return numberText_(mappingRow[mappingColumns[header]]) !== '';
    });
    if (!hasInput) continue;
    plan.targetCount++;

    var oldSku = numberText_(mappingRow[mappingColumns['旧システム連携用SKU番号']]);
    if (!oldSku) {
      plan.errors.push((i + 1) + '行目: 旧システム連携用SKU番号が空欄です');
      continue;
    }
    var matches = skuRowsByNumber[numberKey_(oldSku)] || [];
    if (!matches.length) {
      var oldItem = numberText_(mappingRow[mappingColumns['旧商品番号']]);
      var newItem = numberText_(mappingRow[mappingColumns['新商品番号']]);
      var newSku = numberText_(mappingRow[mappingColumns['新システム連携用SKU番号']]);
      var inferredSingle = oldItem && newItem && newSku &&
        numberKey_(oldItem) === numberKey_(oldSku) &&
        numberKey_(newItem) === numberKey_(newSku);
      var missingType = numberText_(mappingRow[mappingColumns['SKU区分']]);
      if (!inferredSingle || (missingType && missingType !== 'シングル')) {
        plan.errors.push((i + 1) + '行目: 旧システム連携用SKU番号が楽天CSVに見つかりません（シングルSKUとも判定できません）');
        continue;
      }
      if (!missingType) {
        plan.changes.push({
          row: i + 1, rowIndex: i, colIndex: mappingColumns['SKU区分'],
          header: 'SKU区分', from: '', to: 'シングル'
        });
      }
      var missingNote = numberText_(mappingRow[mappingColumns['備考']]);
      if (!hasRakutenSkipMarker_(missingNote)) {
        plan.changes.push({
          row: i + 1, rowIndex: i, colIndex: mappingColumns['備考'],
          header: '備考', from: missingNote, to: addRakutenSkipMarker_(missingNote)
        });
      }
      plan.warnings.push((i + 1) + '行目: 楽天CSVに存在しないため楽天番号移行をスキップ');
      plan.skipped++;
      continue;
    }
    if (matches.length > 1) {
      plan.errors.push((i + 1) + '行目: 旧システム連携用SKU番号が楽天CSVの複数行にあります');
      continue;
    }

    var match = matches[0];
    if (!match.url) {
      plan.errors.push((i + 1) + '行目: 楽天CSVの商品管理番号（商品URL）が空欄です');
      continue;
    }
    var expectedType = (skuCountByUrl[match.urlKey] || 0) >= 2 ? 'マルチ' : 'シングル';
    var currentUrl = numberText_(mappingRow[mappingColumns['商品管理番号（商品URL）']]);
    var currentType = numberText_(mappingRow[mappingColumns['SKU区分']]);
    var currentNote = numberText_(mappingRow[mappingColumns['備考']]);

    if (expectedType === 'マルチ') {
      var commonOldItem = productNumberByUrl[match.urlKey];
      var anchor = commonOldItem ? mappingRowByOldSku[numberKey_(commonOldItem)] : null;
      var commonNewItem = anchor ?
        numberText_(anchor.row[mappingColumns['新システム連携用SKU番号']]) : '';
      var groupedRows = (mappingRowsByRakutenUrl[match.urlKey] || []).map(function(entry) {
        return entry.row;
      });
      var productNumberIsSku = !!(commonOldItem && skuKeysByUrl[match.urlKey] &&
        skuKeysByUrl[match.urlKey][numberKey_(commonOldItem)]);

      if (!commonNewItem && commonOldItem && !productNumberIsSku) {
        var dedicatedNewItems = {};
        groupedRows.forEach(function(groupedRow) {
          if (numberKey_(groupedRow[mappingColumns['旧商品番号']]) !== numberKey_(commonOldItem)) return;
          var candidate = numberText_(groupedRow[mappingColumns['新商品番号']]);
          if (candidate) dedicatedNewItems[numberKey_(candidate)] = candidate;
        });
        var dedicatedNewItemKeys = Object.keys(dedicatedNewItems);
        if (dedicatedNewItemKeys.length === 1) {
          commonNewItem = dedicatedNewItems[dedicatedNewItemKeys[0]];
        }
      }

      if (!commonOldItem || !commonNewItem) {
        if (productNumberIsSku && missingSkuErrorByUrl[match.urlKey]) {
          anchorErrorByUrl[match.urlKey] = true;
        }
        if (!anchorErrorByUrl[match.urlKey]) {
          if (productNumberIsSku) {
            plan.errors.push((i + 1) + '行目: 楽天の商品番号「' + commonOldItem +
              '」と同じ旧システム連携用SKU番号が対照表にありません。' +
              'この番号は楽天CSV上で商品番号兼SKUのため対照表に追加し、' +
              'ほかのSKU行の旧商品番号・新商品番号も共通値にしてください');
          } else {
            plan.errors.push((i + 1) + '行目: マルチSKU専用の商品番号「' +
              (commonOldItem || '未取得') + '」の新商品番号を特定できません。' +
              '同じ商品のいずれか1行に旧商品番号と新商品番号を入力してください');
          }
          anchorErrorByUrl[match.urlKey] = true;
        }
      } else {
        var currentOldItem = numberText_(mappingRow[mappingColumns['旧商品番号']]);
        var currentNewItem = numberText_(mappingRow[mappingColumns['新商品番号']]);
        if (numberKey_(currentOldItem) !== numberKey_(commonOldItem)) {
          plan.changes.push({
            row: i + 1, rowIndex: i, colIndex: mappingColumns['旧商品番号'],
            header: '旧商品番号', from: currentOldItem, to: commonOldItem
          });
        }
        if (numberKey_(currentNewItem) !== numberKey_(commonNewItem)) {
          plan.changes.push({
            row: i + 1, rowIndex: i, colIndex: mappingColumns['新商品番号'],
            header: '新商品番号', from: currentNewItem, to: commonNewItem
          });
        }
      }
    }

    if (currentUrl && numberKey_(currentUrl) !== match.urlKey) {
      plan.errors.push((i + 1) + '行目: 商品管理番号（商品URL）が楽天CSVと不一致です');
    } else if (!currentUrl) {
      plan.changes.push({
        row: i + 1,
        rowIndex: i,
        colIndex: mappingColumns['商品管理番号（商品URL）'],
        header: '商品管理番号（商品URL）',
        from: '',
        to: match.url
      });
    }
    if (currentType && currentType !== expectedType) {
      plan.errors.push((i + 1) + '行目: SKU区分が楽天CSVの判定と不一致です');
    } else if (!currentType) {
      plan.changes.push({
        row: i + 1,
        rowIndex: i,
        colIndex: mappingColumns['SKU区分'],
        header: 'SKU区分',
        from: '',
        to: expectedType
      });
    }
    if (currentUrl && numberKey_(currentUrl) === match.urlKey && currentType === expectedType) {
      plan.alreadyFilled++;
    }
    if (hasRakutenSkipMarker_(currentNote)) {
      plan.changes.push({
        row: i + 1, rowIndex: i, colIndex: mappingColumns['備考'],
        header: '備考', from: currentNote, to: removeRakutenSkipMarker_(currentNote)
      });
    }
  }
  return plan;
}

function planRakutenNumberMigration_(data, mapping) {
  var required = requiredNmHeaders_(data, [
    '商品管理番号（商品URL）', '商品番号',
    '選択肢タイプ', 'SKU管理番号', 'システム連携用SKU番号'
  ]);
  var plan = {
    changes: [],
    errors: mapping.errors.slice().concat(required.errors),
    alreadyConverted: 0,
    targetCount: 0
  };
  if (plan.errors.length) return plan;

  var columns = required.map;
  var groups = {};
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var rawUrl = numberText_(row[columns['商品管理番号（商品URL）']]);
    var urlKey = numberKey_(rawUrl);
    var skuManagement = numberText_(row[columns['SKU管理番号']]);
    var optionType = numberText_(row[columns['選択肢タイプ']]);
    var productNumber = numberText_(row[columns['商品番号']]);
    var mappingGroup = mapping.byUrl[urlKey];
    if (!mappingGroup) continue;
    if (!groups[urlKey]) groups[urlKey] = { skuCount: 0, firstRow: i + 1, hasProduct: false };

    if (productNumber && !skuManagement && !optionType) {
      plan.targetCount++;
      groups[urlKey].hasProduct = true;
      var currentItem = numberText_(row[columns['商品番号']]);
      if (numberKey_(currentItem) === numberKey_(mappingGroup.oldItem)) {
        plan.changes.push({
          row: i + 1,
          rowIndex: i,
          colIndex: columns['商品番号'],
          url: rawUrl,
          skuMgmt: '',
          header: '商品番号',
          from: currentItem,
          to: mappingGroup.newItem
        });
      } else if (numberKey_(currentItem) === numberKey_(mappingGroup.newItem)) {
        plan.alreadyConverted++;
      } else {
        plan.errors.push((i + 1) + '行目: 商品番号が旧・新番号と一致しません');
      }
    }

    if (skuManagement && !optionType) {
      plan.targetCount++;
      groups[urlKey].skuCount++;
      var currentSku = numberText_(row[columns['システム連携用SKU番号']]);
      var mappingRow = mapping.byOldSku[numberKey_(currentSku)] || mapping.byNewSku[numberKey_(currentSku)];
      if (!mappingRow || numberKey_(mappingRow.url) !== urlKey) {
        plan.errors.push((i + 1) + '行目: SKU番号を対照表で特定できません');
      } else if (numberKey_(currentSku) === numberKey_(mappingRow.oldSku)) {
        plan.changes.push({
          row: i + 1,
          rowIndex: i,
          colIndex: columns['システム連携用SKU番号'],
          url: rawUrl,
          skuMgmt: skuManagement,
          header: 'システム連携用SKU番号',
          from: currentSku,
          to: mappingRow.newSku
        });
      } else {
        plan.alreadyConverted++;
      }
    }
  }

  Object.keys(groups).forEach(function(urlKey) {
    var group = groups[urlKey];
    var mapped = mapping.byUrl[urlKey];
    if (group.hasProduct && mapped && group.skuCount !== mapped.rows.length) {
      plan.errors.push(group.firstRow + '行目: SKU件数が対照表と一致しません（CSV ' +
        group.skuCount + '件 / 対照表 ' + mapped.rows.length + '件）');
    }
  });
  return plan;
}

function buildRakutenMigrationTargetProjection_(data, mapping) {
  var required = requiredNmHeaders_(data, RAKUTEN_NUMBER_MIGRATION_REQUIRED_HEADERS_);
  var mappingErrors = mapping && mapping.errors ? mapping.errors.slice() : [];
  var result = {
    data: [],
    sourceRowIndices: [],
    errors: mappingErrors.concat(required.errors),
    retainedProductCount: 0,
    retainedRowCount: 0,
    excludedProductCount: 0,
    excludedRowCount: 0
  };
  if (required.errors.length || !data || !data.length) return result;

  var columns = required.map;
  var blocks = [];
  var currentBlock = null;
  for (var i = 1; i < data.length; i++) {
    var sourceRow = data[i] || [];
    var isProductRow = numberText_(sourceRow[columns['商品番号']]) &&
      !numberText_(sourceRow[columns['SKU管理番号']]) &&
      !numberText_(sourceRow[columns['選択肢タイプ']]);
    if (isProductRow) {
      if (currentBlock) {
        currentBlock.endIndex = i;
        blocks.push(currentBlock);
      }
      currentBlock = {
        url: numberText_(sourceRow[columns['商品管理番号（商品URL）']]),
        startIndex: i,
        endIndex: data.length
      };
    }
  }
  if (currentBlock) blocks.push(currentBlock);

  var byUrl = mapping && mapping.byUrl ? mapping.byUrl : {};
  var foundCounts = {};
  result.data = [data[0].slice()];
  result.sourceRowIndices = [0];
  result.excludedRowCount = blocks.length ? blocks[0].startIndex - 1 : data.length - 1;
  blocks.forEach(function(block) {
    var urlKey = numberKey_(block.url);
    var blockRowCount = block.endIndex - block.startIndex;
    if (!byUrl[urlKey]) {
      result.excludedProductCount++;
      result.excludedRowCount += blockRowCount;
      return;
    }
    foundCounts[urlKey] = (foundCounts[urlKey] || 0) + 1;
    result.retainedProductCount++;
    result.retainedRowCount += blockRowCount;
    for (var rowIndex = block.startIndex; rowIndex < block.endIndex; rowIndex++) {
      result.data.push((data[rowIndex] || []).slice());
      result.sourceRowIndices.push(rowIndex);
    }
  });

  Object.keys(byUrl).forEach(function(urlKey) {
    var mappingGroup = byUrl[urlKey];
    var displayUrl = mappingGroup.rows && mappingGroup.rows.length ? mappingGroup.rows[0].url : urlKey;
    if (!foundCounts[urlKey]) {
      result.errors.push('商品管理番号（商品URL）「' + displayUrl + '」がrakuten_csvに見つかりません');
    } else if (foundCounts[urlKey] > 1) {
      result.errors.push('商品管理番号（商品URL）「' + displayUrl + '」の商品ブロックが' +
        foundCounts[urlKey] + '件あります');
    }
  });
  if (result.retainedProductCount === 0) result.errors.push('番号移行対象の商品がありません');

  return result;
}

function planRakutenInPlaceMigration_(data, mapping) {
  var projection = buildRakutenMigrationTargetProjection_(data, mapping);
  var migrationPlan = projection.data.length ?
    planRakutenNumberMigration_(projection.data, mapping) :
    { changes: [], errors: [], alreadyConverted: 0, targetCount: 0 };
  var errors = projection.errors.slice();
  migrationPlan.errors.forEach(function(error) {
    if (errors.indexOf(error) !== -1) return;
    var mappedError = error.replace(/^(\d+)行目:/, function(match, rowNumber) {
      var outputRowIndex = Number(rowNumber) - 1;
      var sourceRowIndex = projection.sourceRowIndices[outputRowIndex];
      return sourceRowIndex === undefined ? match : (sourceRowIndex + 1) + '行目:';
    });
    if (errors.indexOf(mappedError) === -1) errors.push(mappedError);
  });

  // Projection rows are already cloned from the input; mutate them into the rebuild output.
  var outputData = projection.data;
  var changes = migrationPlan.changes.map(function(change) {
    var outputRowIndex = change.rowIndex;
    var sourceRowIndex = projection.sourceRowIndices[outputRowIndex];
    var mappedChange = {};
    Object.keys(change).forEach(function(key) { mappedChange[key] = change[key]; });
    mappedChange.row = sourceRowIndex + 1;
    mappedChange.rowIndex = sourceRowIndex;
    mappedChange.sourceRow = sourceRowIndex + 1;
    mappedChange.outputRowIndex = outputRowIndex;
    outputData[outputRowIndex][change.colIndex] = change.to;
    return mappedChange;
  });

  return {
    errors: errors,
    changes: changes,
    alreadyConverted: migrationPlan.alreadyConverted,
    targetCount: migrationPlan.targetCount,
    outputData: outputData,
    retainedProductCount: projection.retainedProductCount,
    retainedRowCount: projection.retainedRowCount,
    excludedProductCount: projection.excludedProductCount,
    excludedRowCount: projection.excludedRowCount
  };
}

function migrationCellValuesEqual_(actual, expected) {
  var actualIsDate = Object.prototype.toString.call(actual) === '[object Date]';
  var expectedIsDate = Object.prototype.toString.call(expected) === '[object Date]';
  if (actualIsDate || expectedIsDate) {
    if (!actualIsDate || !expectedIsDate) return false;
    var actualTime = actual.getTime();
    var expectedTime = expected.getTime();
    return !isNaN(actualTime) && !isNaN(expectedTime) && actualTime === expectedTime;
  }
  return actual === expected;
}

function validateRakutenRebuiltData_(data, mapping, expectedOutput) {
  var plan = planRakutenNumberMigration_(data, mapping);
  var required = requiredNmHeaders_(data, RAKUTEN_NUMBER_MIGRATION_REQUIRED_HEADERS_);
  var byUrl = mapping && mapping.byUrl ? mapping.byUrl : {};
  var foundCounts = {};
  var currentTarget = false;
  var productCount = 0;
  var excludedProductCount = 0;
  var excludedRowCount = 0;
  var equal = !!expectedOutput && data.length === expectedOutput.length;
  var columns = required.map;

  for (var i = 0; i < data.length; i++) {
    var row = data[i] || [];
    if (equal) {
      var expectedRow = expectedOutput[i] || [];
      if (row.length !== expectedRow.length) {
        equal = false;
      } else {
        for (var columnIndex = 0; columnIndex < row.length; columnIndex++) {
          if (!migrationCellValuesEqual_(row[columnIndex], expectedRow[columnIndex])) {
            equal = false;
            break;
          }
        }
      }
    }
    if (i > 0 && !required.errors.length) {
      var isProductRow = numberText_(row[columns['商品番号']]) &&
        !numberText_(row[columns['SKU管理番号']]) &&
        !numberText_(row[columns['選択肢タイプ']]);
      if (isProductRow) {
        var urlKey = numberKey_(row[columns['商品管理番号（商品URL）']]);
        currentTarget = !!byUrl[urlKey];
        if (currentTarget) {
          productCount++;
          foundCounts[urlKey] = (foundCounts[urlKey] || 0) + 1;
        } else {
          excludedProductCount++;
        }
      }
      if (!currentTarget) excludedRowCount++;
    }
  }
  if (!required.errors.length) {
    Object.keys(byUrl).forEach(function(urlKey) {
      var group = byUrl[urlKey];
      var displayUrl = group.rows && group.rows.length ? group.rows[0].url : urlKey;
      if (!foundCounts[urlKey]) {
        plan.errors.push('商品管理番号（商品URL）「' + displayUrl + '」がrakuten_csvに見つかりません');
      } else if (foundCounts[urlKey] > 1) {
        plan.errors.push('商品管理番号（商品URL）「' + displayUrl + '」の商品ブロックが' +
          foundCounts[urlKey] + '件あります');
      }
    });
  }
  if (!equal) plan.errors.push('楽天CSVの書き戻し結果が予定内容と一致しません');
  plan.retainedProductCount = productCount;
  plan.retainedRowCount = Math.max(0, data.length - 1 - excludedRowCount);
  plan.excludedProductCount = excludedProductCount;
  plan.excludedRowCount = excludedRowCount;
  return plan;
}

function ensureMigrationSheetCapacity_(sheet, requiredRows, requiredColumns) {
  var currentRows = sheet.getMaxRows();
  if (currentRows < requiredRows) sheet.insertRowsAfter(currentRows, requiredRows - currentRows);
  var currentColumns = sheet.getMaxColumns();
  if (currentColumns < requiredColumns) {
    sheet.insertColumnsAfter(currentColumns, requiredColumns - currentColumns);
  }
}

function buildRakutenMigrationDownloadSnapshot_(ss) {
  var snapshot = { data: null, key: '', rowCount: 0, errors: [] };
  var sourceSheet = ss.getSheetByName(SHEET_NAMES.RAKUTEN_CSV);
  if (!sourceSheet || sourceSheet.getLastRow() < 2) {
    snapshot.errors.push('rakuten_csvシートにダウンロード対象データがありません');
    return snapshot;
  }

  snapshot.data = sourceSheet.getDataRange().getValues();
  snapshot.rowCount = snapshot.data.length - 1;
  var mapping = loadNumberMapping_();
  var plan = validateRakutenRebuiltData_(snapshot.data, mapping, snapshot.data);
  snapshot.errors = plan.errors.slice();
  if (plan.changes.length) snapshot.errors.push('未変換の番号が' + plan.changes.length + '件あります。④ 楽天変換実行を先に実行してください');
  if (plan.excludedProductCount || plan.excludedRowCount) snapshot.errors.push(
    'rakuten_csvに番号移行対象外の商品または行が残っています（商品 ' +
    plan.excludedProductCount + '件 / 行 ' + plan.excludedRowCount + '件）'
  );
  snapshot.errors = snapshot.errors.concat(
    validateRakutenExportRows_(snapshot.data, RAKUTEN_NUMBER_MIGRATION_REQUIRED_HEADERS_)
  );
  snapshot.key = migrationSignature_('楽天CSVダウンロード', snapshot.data, mapping);
  return snapshot;
}

function rakutenMigrationDownloadSnapshotKey_(snapshot) {
  return snapshot ? snapshot.key : '';
}

function readRakutenMigrationDownloadSnapshotWithLock_(ss) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(3000)) return { busy: true, snapshot: null };
  var snapshot;
  try {
    snapshot = buildRakutenMigrationDownloadSnapshot_(ss);
  } catch (error) {
    snapshot = {
      data: null,
      key: '',
      rowCount: 0,
      errors: [error && error.message ? error.message : String(error)]
    };
  } finally {
    try {
      lock.releaseLock();
    } catch (releaseError) {
      if (!snapshot) snapshot = { data: null, key: '', rowCount: 0, errors: [] };
      snapshot.errors.push('処理ロックの解放に失敗しました: ' +
        (releaseError && releaseError.message ? releaseError.message : String(releaseError)));
    }
  }
  return { busy: false, snapshot: snapshot };
}

/** 再構築・検証済みのrakuten_csvを楽天取込CSVとして出力する。 */
function downloadRakutenMigrationCsv() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();
  var readResult = readRakutenMigrationDownloadSnapshotWithLock_(ss);
  if (readResult.busy) {
    notifyMessage_(ui, ss, '楽天番号移行CSV実行中',
      '他の処理が実行中です。完了後に再実行してください。');
    return;
  }
  var snapshot = readResult.snapshot;
  var data = snapshot.data;
  var errors = snapshot.errors;

  if (errors.length) {
    notifyMessage_(ui, ss, data ? '出力前チェックエラー' : 'エラー',
      errors.slice(0, 20).join('\n'));
    return;
  }

  var dataRowCount = snapshot.rowCount;
  var snapshotKey = snapshot.key;
  data = null;
  snapshot.data = null;
  snapshot = null;
  var confirm = ui.alert(
    'CSVダウンロード（楽天）',
    'rakuten_csvをnormal-item.csvとして出力します。\n対象行数: ' + dataRowCount + '行',
    ui.ButtonSet.YES_NO
  );
  if (confirm !== ui.Button.YES) return;

  var confirmedRead = readRakutenMigrationDownloadSnapshotWithLock_(ss);
  if (confirmedRead.busy) {
    notifyMessage_(ui, ss, '出力中止',
      '確認中に他の処理が開始されました。内容を再確認してから再実行してください。');
    return;
  }
  var confirmedSnapshot = confirmedRead.snapshot;
  if (confirmedSnapshot.errors.length ||
      rakutenMigrationDownloadSnapshotKey_(confirmedSnapshot) !== snapshotKey) {
    var changedErrors = confirmedSnapshot.errors.slice(0, 19);
    changedErrors.unshift('確認中にrakuten_csvまたは対照表が変更されました。内容を再確認してから再実行してください。');
    notifyMessage_(ui, ss, '出力中止', changedErrors.join('\n'));
    return;
  }

  data = confirmedSnapshot.data;
  downloadCsvShiftJis_(data, 'normal-item.csv', '楽天CSV作成中...');
  recordOperationResult_({
    operation: '楽天CSV',
    mode: 'ダウンロード',
    status: '生成完了',
    success: dataRowCount
  });
}

function planAnaNumberMigration_(data, mapping) {
  var required = requiredNmHeaders_(data, ['返礼品識別コード', '備考(内部用)']);
  var plan = {
    changes: [],
    errors: mapping.errors.slice().concat(required.errors),
    alreadyConverted: 0,
    targetCount: 0
  };
  if (plan.errors.length) return plan;

  var columns = required.map;
  for (var i = 1; i < data.length; i++) {
    var identifier = numberText_(data[i][columns['返礼品識別コード']]);
    var note = numberText_(data[i][columns['備考(内部用)']]);
    if (!identifier && !note) continue;
    plan.targetCount++;
    var mappingRow = mapping.byOldSku[numberKey_(identifier)];
    if (!mappingRow) {
      plan.errors.push((i + 1) + '行目: 返礼品識別コードが対照表にありません');
    } else if (!note) {
      plan.changes.push({
        row: i + 1,
        rowIndex: i,
        colIndex: columns['備考(内部用)'],
        url: '',
        skuMgmt: '',
        header: '備考(内部用)',
        from: '',
        to: mappingRow.newSku
      });
    } else if (numberKey_(note) === numberKey_(mappingRow.newSku)) {
      plan.alreadyConverted++;
    } else {
      plan.errors.push((i + 1) + '行目: 備考に別の値があります');
    }
  }
  return plan;
}
function planMultiSkuImages_(data, pathMap, mapping) {
  var required = requiredNmHeaders_(data, [
    '商品管理番号（商品URL）', '商品番号', 'SKU管理番号',
    'システム連携用SKU番号', 'SKU画像タイプ', 'SKU画像パス'
  ]);
  var plan = {
    changes: [],
    errors: mapping.errors.slice().concat(required.errors),
    warnings: []
  };
  if (plan.errors.length) return plan;

  var columns = required.map;
  var skuCounts = {};
  for (var i = 1; i < data.length; i++) {
    var skuManagement = numberText_(data[i][columns['SKU管理番号']]);
    var itemNumber = numberText_(data[i][columns['商品番号']]);
    if (skuManagement && !itemNumber) {
      var countUrl = numberKey_(data[i][columns['商品管理番号（商品URL）']]);
      skuCounts[countUrl] = (skuCounts[countUrl] || 0) + 1;
    }
  }

  for (var j = 1; j < data.length; j++) {
    var row = data[j];
    var rawUrl = numberText_(row[columns['商品管理番号（商品URL）']]);
    var urlKey = numberKey_(rawUrl);
    var skuManagement = numberText_(row[columns['SKU管理番号']]);
    var itemNumber = numberText_(row[columns['商品番号']]);
    if ((skuCounts[urlKey] || 0) < 2 || !skuManagement || itemNumber) continue;

    var currentCode = numberKey_(row[columns['システム連携用SKU番号']]);
    var mappingRow = mapping.byNewSku[currentCode] || mapping.byOldSku[currentCode];
    if (!mappingRow || numberKey_(mappingRow.url) !== urlKey) {
      plan.errors.push((j + 1) + '行目: SKU画像用の番号を対照表で特定できません');
      continue;
    }

    var files = pathMap[numberKey_(mappingRow.newSku)];
    var usedFallback = false;
    if (!files || !files.length || !files[0]) {
      files = pathMap[numberKey_(mappingRow.oldSku)];
      usedFallback = !!(files && files.length && files[0]);
    }
    if (!files || !files.length || !files[0]) {
      plan.errors.push((j + 1) + '行目: SKU画像が見つかりません');
      continue;
    }

    plan.changes.push({
      row: j + 1,
      rowIndex: j,
      url: rawUrl,
      skuMgmt: skuManagement,
      type: 'CABINET',
      path: files[0],
      typeCol: columns['SKU画像タイプ'],
      pathCol: columns['SKU画像パス']
    });
    if (usedFallback) plan.warnings.push((j + 1) + '行目: 旧番号画像を使用');
  }
  return plan;
}

function buildMigrationColumnWrites_(data, changes) {
  var columns = {};
  changes.forEach(function(change) {
    if (!columns[change.colIndex]) {
      columns[change.colIndex] = data.slice(1).map(function(row) {
        return [row[change.colIndex]];
      });
    }
    columns[change.colIndex][change.rowIndex - 1] = [change.to];
  });
  return Object.keys(columns).map(function(colIndex) {
    return { colIndex: Number(colIndex), values: columns[colIndex] };
  }).sort(function(a, b) { return a.colIndex - b.colIndex; });
}

function applyMigrationChanges_(sheet, data, changes) {
  buildMigrationColumnWrites_(data, changes).forEach(function(write) {
    sheet.getRange(2, write.colIndex + 1, write.values.length, 1).setValues(write.values);
  });
}

function rewriteRakutenCsvInPlace_(sheet, originalData, outputData) {
  if (!outputData || !outputData.length || !outputData[0].length) {
    throw new Error('書き戻す楽天CSVデータがありません');
  }
  var originalRows = Math.max(1, originalData && originalData.length ? originalData.length : 1);
  var originalColumns = 1;
  (originalData || []).forEach(function(row) {
    originalColumns = Math.max(originalColumns, row ? row.length : 0);
  });
  ensureMigrationSheetCapacity_(sheet, outputData.length, outputData[0].length);
  sheet.getRange(1, 1, originalRows, originalColumns).clearContent();
  sheet.getRange(1, 1, outputData.length, outputData[0].length).setValues(outputData);
}

function buildMultiSkuImageColumnWrites_(data, changes) {
  var cellChanges = [];
  changes.forEach(function(change) {
    cellChanges.push({ rowIndex: change.rowIndex, colIndex: change.typeCol, to: change.type });
    cellChanges.push({ rowIndex: change.rowIndex, colIndex: change.pathCol, to: change.path });
  });
  return buildMigrationColumnWrites_(data, cellChanges);
}

function applyMultiSkuImageChanges_(sheet, data, changes) {
  buildMultiSkuImageColumnWrites_(data, changes).forEach(function(write) {
    sheet.getRange(2, write.colIndex + 1, write.values.length, 1).setValues(write.values);
  });
}

function loadNumberMapping_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAMES.NUMBER_MAPPING);
  if (!sheet) throw new Error('number_mappingシートがありません。初期設定（差分更新）を実行してください。');
  return parseNumberMapping_(sheet.getDataRange().getValues());
}

function migrationSignature_(kind, data, mapping) {
  var mappingValues = mapping.rows.map(function(row) {
    return [row.url, row.oldItem, row.newItem, row.oldSku, row.newSku, row.type,
      row.note, !!row.skipRakuten];
  });
  return Utilities.base64EncodeWebSafe(Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    JSON.stringify([kind, data, mapping.errors || [], mappingValues])
  ));
}

function buildMigrationDashboardData_(kind, mode, plan, timestamp) {
  var headers = [
    '処理', '実行日時', 'モード', '対象件数', '変更予定', '変換済み', 'エラー',
    '残す商品数', '残す行数', '除外商品数', '除外行数',
    '行', '商品管理番号（商品URL）', 'SKU管理番号', '列', '変更前', '変更後', '結果・理由'
  ];
  var targetCount = plan.targetCount === undefined ?
    plan.changes.length + plan.alreadyConverted : plan.targetCount;
  var rows = [[
    kind, timestamp, mode, targetCount, plan.changes.length, plan.alreadyConverted,
    plan.errors.length,
    plan.retainedProductCount === undefined ? '' : plan.retainedProductCount,
    plan.retainedRowCount === undefined ? '' : plan.retainedRowCount,
    plan.excludedProductCount === undefined ? '' : plan.excludedProductCount,
    plan.excludedRowCount === undefined ? '' : plan.excludedRowCount,
    '', '', '', '', '', '', 'サマリー'
  ]];
  plan.changes.forEach(function(change) {
    rows.push([
      kind, timestamp, mode, '', '', '', '', '', '', '', '',
      change.row, change.url || '', change.skuMgmt || '',
      change.header || 'SKU画像', change.from || '', change.to || change.path || '', '変更予定'
    ]);
  });
  plan.errors.forEach(function(error) {
    rows.push([
      kind, timestamp, mode, '', '', '', '', '', '', '', '',
      '', '', '', '', '', '', 'エラー: ' + error
    ]);
  });
  return { headers: headers, rows: rows };
}

function writeMigrationDashboard_(kind, mode, plan) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAMES.NUMBER_MIGRATION_DASHBOARD) ||
    ss.insertSheet(SHEET_NAMES.NUMBER_MIGRATION_DASHBOARD);
  var timestamp = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss');
  var dashboard = buildMigrationDashboardData_(kind, mode, plan, timestamp);
  sheet.clear();
  sheet.getRange(1, 1, 1, dashboard.headers.length).setValues([dashboard.headers]);
  sheet.getRange(2, 1, dashboard.rows.length, dashboard.headers.length).setValues(dashboard.rows);
}

function backupMigrationChanges_(sheet, prefix, changes) {
  var spreadsheet = sheet.getParent();
  var filename = prefix + Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd_HHmmss') + '.csv';
  var rows = [[
    '元行番号', '商品管理番号（商品URL）', 'SKU管理番号', '変更列', '変更前', '変更後'
  ]];
  (changes || []).forEach(function(change) {
    rows.push([
      change.row, change.url || '', change.skuMgmt || '', change.header || '',
      change.from === undefined ? '' : change.from,
      change.to === undefined ? '' : change.to
    ]);
  });
  var blob = Utilities.newBlob('\uFEFF' + buildCsvText_(rows), 'text/csv', filename);
  var parents = DriveApp.getFileById(spreadsheet.getId()).getParents();
  if (parents.hasNext()) return parents.next().createFile(blob);
  return DriveApp.createFile(blob);
}

function createNumberMigrationPlan_(kind, data, mapping) {
  return kind === '楽天' ?
    planRakutenInPlaceMigration_(data, mapping) :
    planAnaNumberMigration_(data, mapping);
}

function buildNumberMigrationSummary_(kind, isDry, plan) {
  var lines = [
    '変更' + (isDry ? '予定' : '') + ': ' + plan.changes.length + '件',
    '変換済み: ' + plan.alreadyConverted + '件'
  ];
  if (plan.retainedProductCount !== undefined) {
    lines.push('残す商品: ' + plan.retainedProductCount + '件（' + plan.retainedRowCount + '行）');
    lines.push('除外商品: ' + plan.excludedProductCount + '件（' + plan.excludedRowCount + '行）');
  }
  lines.push('エラー: 0件');
  return lines.join('\n');
}

function runNumberMigration_(kind, isDry) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var mapping = loadNumberMapping_();
  var sheetName = kind === '楽天' ? SHEET_NAMES.RAKUTEN_CSV : SHEET_NAMES.ANA_CSV;
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error('対象シート「' + sheetName + '」がありません');

  var data = sheet.getDataRange().getValues();
  var plan = createNumberMigrationPlan_(kind, data, mapping);
  var signature = migrationSignature_(kind, data, mapping);
  writeMigrationDashboard_(kind, isDry ? 'ドライラン' : '本実行', plan);
  if (plan.errors.length) throw new Error(plan.errors.slice(0, 20).join('\n'));

  var properties = PropertiesService.getScriptProperties();
  var dryRunKey = 'NUMBER_MIGRATION_DRY_' + kind;
  if (isDry) {
    properties.setProperty(dryRunKey, signature);
    return { kind: kind, isDry: true, plan: plan, cancelled: false };
  }
  if (properties.getProperty(dryRunKey) !== signature) {
    throw new Error('同じ対照表・対象CSVに対するドライランを先に実行してください。');
  }

  if (kind === '楽天') {
    delete plan.outputData;
    data = null;
  }

  var ui = SpreadsheetApp.getUi();
  var answer = ui.alert(
    kind + '番号移行の本実行',
    buildNumberMigrationSummary_(kind, true, plan) +
      '\n対象シートをバックアップしてから更新します。実行しますか？',
    ui.ButtonSet.YES_NO
  );
  if (answer !== ui.Button.YES) {
    return { kind: kind, isDry: false, plan: plan, cancelled: true };
  }

  if (kind !== '楽天') {
    try {
      backupMigrationChanges_(sheet, 'ana_csv_backup_', plan.changes);
    } catch (backupError) {
      throw new Error('バックアップ作成に失敗しました: ' +
        (backupError && backupError.message ? backupError.message : String(backupError)));
    }
    applyMigrationChanges_(sheet, data, plan.changes);
    if (typeof SpreadsheetApp.flush === 'function') SpreadsheetApp.flush();
    var anaPostPlan = createNumberMigrationPlan_(kind, sheet.getDataRange().getValues(), mapping);
    if (anaPostPlan.errors.length || anaPostPlan.changes.length) {
      throw new Error('更新後の再検証に失敗しました。作成済みのバックアップを確認してください。\n' +
        anaPostPlan.errors.slice(0, 10).join('\n'));
    }
    properties.deleteProperty(dryRunKey);
    return { kind: kind, isDry: false, plan: plan, postPlan: anaPostPlan, cancelled: false };
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(3000)) {
    throw new Error('実行ロック取得に失敗しました。他の処理が実行中です。');
  }
  try {
    var currentMapping = loadNumberMapping_();
    var currentData = sheet.getDataRange().getValues();
    var currentSignature = migrationSignature_(kind, currentData, currentMapping);
    if (currentSignature !== signature || properties.getProperty(dryRunKey) !== currentSignature) {
      throw new Error('確認中に対照表または対象CSVが変更されました。楽天ドライランを再実行してください。');
    }
    var currentPlan = createNumberMigrationPlan_(kind, currentData, currentMapping);
    if (currentPlan.errors.length) {
      throw new Error('実行前再検証に失敗しました: ' + currentPlan.errors.slice(0, 20).join('\n'));
    }
    try {
      backupMigrationChanges_(sheet, 'rakuten_csv_backup_', currentPlan.changes);
    } catch (rakutenBackupError) {
      throw new Error('楽天CSVバックアップ作成に失敗しました: ' +
        (rakutenBackupError && rakutenBackupError.message ? rakutenBackupError.message : String(rakutenBackupError)));
    }
    try {
      var expectedOutput = currentPlan.outputData;
      delete currentPlan.outputData;
      rewriteRakutenCsvInPlace_(sheet, currentData, expectedOutput);
      currentData = null;
      if (typeof SpreadsheetApp.flush === 'function') SpreadsheetApp.flush();
    } catch (rewriteError) {
      throw new Error('楽天CSV再構築に失敗しました: ' +
        (rewriteError && rewriteError.message ? rewriteError.message : String(rewriteError)));
    }

    var postData = sheet.getDataRange().getValues();
    var postPlan = validateRakutenRebuiltData_(postData, currentMapping, expectedOutput);
    var postInvalid = postPlan.errors.length || postPlan.changes.length ||
      postPlan.excludedProductCount !== 0 || postPlan.excludedRowCount !== 0;
    postData = null;
    expectedOutput = null;
    if (postInvalid) {
      throw new Error('楽天CSV更新後検証に失敗しました。作成済みのバックアップを確認してください。\n' +
        postPlan.errors.slice(0, 10).join('\n'));
    }
    properties.deleteProperty(dryRunKey);
    return { kind: kind, isDry: false, plan: currentPlan, postPlan: postPlan, cancelled: false };
  } finally {
    try {
      lock.releaseLock();
    } catch (releaseError) {
      // GASがロックを自動解放するため、元の処理結果を優先する。
    }
  }
}

function runNumberMigrationUi_(kind, isDry) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();
  try {
    var result = runNumberMigration_(kind, isDry);
    if (result.cancelled) {
      notifyMessage_(ui, ss, 'キャンセル', '番号移行は実行しませんでした。');
      return;
    }
    var mode = isDry ? 'ドライラン' : '本実行';
    var message = buildNumberMigrationSummary_(kind, isDry, result.plan);
    completeOperation_({
      operation: kind + '番号移行',
      mode: mode,
      status: '完了',
      success: result.plan.changes.length,
      skipped: result.plan.alreadyConverted,
      detail: message
    }, '[Sado] ' + kind + '番号移行完了', message, !isDry);
    notifyMessage_(ui, ss, isDry ? 'ドライラン完了' : '番号移行完了', message);
  } catch (error) {
    var detail = error && error.message ? error.message : String(error);
    completeOperation_({
      operation: kind + '番号移行',
      mode: isDry ? 'ドライラン' : '本実行',
      status: '失敗',
      errors: 1,
      detail: detail
    }, '[Sado] ' + kind + '番号移行エラー', detail, true);
    notifyMessage_(ui, ss, 'エラー', detail);
  }
}

function buildNumberMappingValidationValues_(lastRow, errors) {
  var values = [];
  for (var row = 2; row <= lastRow; row++) values.push(['']);
  errors.forEach(function(error) {
    var match = String(error).match(/^(\d+)行目:/);
    if (!match) return;
    var index = Number(match[1]) - 2;
    if (index < 0 || index >= values.length) return;
    var message = String(error).replace(/^\d+行目:\s*/, '');
    values[index][0] = values[index][0] ? values[index][0] + '\n' + message : message;
  });
  return values;
}

function writeNumberMappingValidationResults_(sheet, mappingData, errors) {
  if (!mappingData || mappingData.length < 2) return;
  var headerMap = headerMapNm_(mappingData[0]);
  if (headerMap['検証結果'] === undefined) return;
  var values = buildNumberMappingValidationValues_(mappingData.length, errors);
  sheet.getRange(2, headerMap['検証結果'] + 1, values.length, 1).setValues(values);
}

/** rakuten_csvから対照表の商品URLとSKU区分を補完する。 */
function autoFillNumberMappingFromRakuten() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();
  try {
    var mappingSheet = ss.getSheetByName(SHEET_NAMES.NUMBER_MAPPING);
    var rakutenSheet = ss.getSheetByName(SHEET_NAMES.RAKUTEN_CSV);
    if (!mappingSheet) throw new Error('number_mappingシートがありません。');
    if (!rakutenSheet) throw new Error('rakuten_csvシートがありません。');

    var mappingData = mappingSheet.getDataRange().getValues();
    var rakutenData = rakutenSheet.getDataRange().getValues();
    var plan = planNumberMappingAutoFill_(mappingData, rakutenData);
    writeNumberMappingValidationResults_(mappingSheet, mappingData, plan.errors.concat(plan.warnings));

    if (plan.errors.length) {
      var errorPreview = plan.errors.slice(0, 20);
      var omittedErrorCount = plan.errors.length - errorPreview.length;
      var errorMessage = '対照表を補完できません。エラー: ' + plan.errors.length + '件\n\n' +
        errorPreview.join('\n') +
        (omittedErrorCount > 0 ? '\n\n残り' + omittedErrorCount + '件を含む全件を「検証結果」列に表示しました。' : '');
      recordOperationResult_({
        operation: '対照表自動補完',
        mode: '楽天CSV',
        status: '検証失敗',
        errors: plan.errors.length,
        detail: errorMessage
      });
      notifyMessage_(ui, ss, '対照表補完エラー', errorMessage);
      return plan;
    }

    applyMigrationChanges_(mappingSheet, mappingData, plan.changes);
    var changedRows = {};
    plan.changes.forEach(function(change) { changedRows[change.rowIndex] = true; });
    var changedRowCount = Object.keys(changedRows).length;
    var message = '補完行: ' + changedRowCount + '件\n' +
      '補完セル: ' + plan.changes.length + '件\n' +
      '補完済み: ' + plan.alreadyFilled + '件\n' +
      '楽天CSV対象外: ' + plan.skipped + '件\n' +
      'エラー: 0件';
    recordOperationResult_({
      operation: '対照表自動補完',
      mode: '楽天CSV',
      status: '完了',
      success: changedRowCount,
      skipped: plan.alreadyFilled + plan.skipped,
      detail: message
    });
    notifyMessage_(ui, ss, '対照表の補完完了', message);
    return plan;
  } catch (error) {
    var detail = error && error.message ? error.message : String(error);
    recordOperationResult_({
      operation: '対照表自動補完',
      mode: '楽天CSV',
      status: '異常終了',
      errors: 1,
      detail: detail
    });
    notifyMessage_(ui, ss, '対照表補完エラー', detail);
    return null;
  }
}

/**
 * 対照表を検証し、結果をシートに書き戻す
 */
function validateNumberMapping() {
  var mapping = loadNumberMapping_();
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAMES.NUMBER_MAPPING);
  writeNumberMappingValidationResults_(sheet, sheet.getDataRange().getValues(), mapping.errors.concat(mapping.warnings));

  var ui = SpreadsheetApp.getUi();
  var successMessage = mapping.warnings.length ?
    '対照表は正常です。\n\n' + mapping.warnings.join('\n') :
    '対照表は正常です。';
  ui.alert(
    mapping.errors.length ? '検証エラー' : '検証完了',
    mapping.errors.length ? mapping.errors.join('\n') : successMessage,
    ui.ButtonSet.OK
  );
}

/** 楽天番号移行ドライラン */
function dryRunRakutenNumberMigration() {
  runNumberMigrationUi_('楽天', true);
}

/** 楽天番号移行本実行 */
function executeRakutenNumberMigration() {
  runNumberMigrationUi_('楽天', false);
}

/** ANA番号移行ドライラン */
function dryRunAnaNumberMigration() {
  runNumberMigrationUi_('ANA', true);
}

/** ANA番号移行本実行 */
function executeAnaNumberMigration() {
  runNumberMigrationUi_('ANA', false);
}

/**
 * 番号移行ダッシュボードを表示する
 */
function showNumberMigrationDashboard() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAMES.NUMBER_MIGRATION_DASHBOARD);
  if (sheet) {
    ss.setActiveSheet(sheet);
  } else {
    SpreadsheetApp.getUi().alert('番号移行ダッシュボードはまだありません。');
  }
}
