const test = require('node:test');
const assert = require('node:assert/strict');
const { loadGas } = require('./load-gas');

const gas = loadGas(['src/Config.js', 'src/Utils.js']);

function loadDownloadGas() {
  const captured = {};
  const htmlOutput = {
    setWidth(width) {
      captured.width = width;
      return this;
    },
    setHeight(height) {
      captured.height = height;
      return this;
    },
  };
  const downloadGas = loadGas(['src/Config.js', 'src/Utils.js'], {
    HtmlService: {
      createHtmlOutput(html) {
        captured.html = html;
        return htmlOutput;
      },
    },
    SpreadsheetApp: {
      getUi() {
        return {
          showModalDialog(output, title) {
            captured.output = output;
            captured.title = title;
          },
        };
      },
    },
  });
  return { gas: downloadGas, captured, htmlOutput };
}

test('buildCsvText_ quotes commas, quotes and newlines with CRLF rows', () => {
  const actual = gas.buildCsvText_([['a,b', 'x"y'], ['line\nbreak', 'plain']]);
  assert.equal(actual, '"a,b","x""y"\r\n"line\nbreak",plain');
});

test('escapeCsvField_ quotes carriage returns and renders nullish fields empty', () => {
  assert.equal(gas.escapeCsvField_('line\rbreak'), '"line\rbreak"');
  assert.equal(gas.escapeCsvField_(null), '');
  assert.equal(gas.escapeCsvField_(undefined), '');
});

test('projectTableByHeaders_ keeps only requested headers in requested order', () => {
  const data = [['B', '内部列', 'A'], ['b', 'secret', 'a']];
  const targetHeaders = ['A', 'B'];
  assert.deepEqual(
    JSON.parse(JSON.stringify(gas.projectTableByHeaders_(data, targetHeaders))),
    [['A', 'B'], ['a', 'b']]
  );
  assert.deepEqual(data, [['B', '内部列', 'A'], ['b', 'secret', 'a']]);
  assert.deepEqual(targetHeaders, ['A', 'B']);
});

test('projectTableByHeaders_ reports every missing required header exactly', () => {
  assert.throws(
    () => gas.projectTableByHeaders_([['A'], ['a']], ['A', 'B', 'C']),
    (error) => {
      assert.equal(error.message, '必須ヘッダー不足: B, C');
      return true;
    }
  );
});

test('serializeForInlineScript_ escapes HTML boundaries and line separators', () => {
  assert.equal(
    gas.serializeForInlineScript_('</script>\u2028\u2029'),
    '"\\u003c/script>\\u2028\\u2029"'
  );
});

test('downloadCsvUtf8_ adds BOM and safely embeds payload and filename', () => {
  const harness = loadDownloadGas();
  harness.gas.downloadCsvUtf8_(
    [['payload</script><script>attack']],
    'name</script>.csv',
    'UTF-8 CSV'
  );

  assert.match(harness.captured.html, /var BOM = "\\uFEFF"/);
  assert.equal((harness.captured.html.match(/<\/script>/g) || []).length, 1);
  assert.doesNotMatch(harness.captured.html, /payload<\/script>|name<\/script>/);
  assert.equal((harness.captured.html.match(/\\u003c\/script>/g) || []).length, 2);
  assert.equal(harness.captured.title, 'UTF-8 CSV');
  assert.equal(harness.captured.output, harness.htmlOutput);
});

test('downloadCsvShiftJis_ pins encoding-japanese and safely embeds payload and filename', () => {
  const harness = loadDownloadGas();
  harness.gas.downloadCsvShiftJis_(
    [['payload</script><script>attack']],
    'name</script>.csv',
    'Shift-JIS CSV'
  );

  assert.match(
    harness.captured.html,
    /https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/encoding-japanese\/2\.0\.0\/encoding\.min\.js/
  );
  assert.equal((harness.captured.html.match(/<\/script>/g) || []).length, 2);
  assert.doesNotMatch(harness.captured.html, /payload<\/script>|name<\/script>/);
  assert.equal((harness.captured.html.match(/\\u003c\/script>/g) || []).length, 2);
  assert.equal(harness.captured.title, 'Shift-JIS CSV');
  assert.equal(harness.captured.output, harness.htmlOutput);
});
