const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const srcDir = path.resolve(__dirname, '..', 'src');
const fixtureDir = path.resolve(__dirname, 'fixtures');

function fixturePath(name) {
  return path.join(fixtureDir, name);
}

function maskCommentsAndStrings(source) {
  const chars = source.split('');
  let state = 'code';
  const templateExpressionDepths = [];

  function followsControlCondition(closeParenIndex) {
    let depth = 0;
    for (let i = closeParenIndex; i >= 0; i--) {
      if (chars[i] === ')') {
        depth++;
      } else if (chars[i] === '(') {
        depth--;
        if (depth === 0) {
          let end = i - 1;
          while (end >= 0 && /\s/.test(chars[end])) end--;
          let start = end;
          while (start >= 0 && /[A-Za-z_$]/.test(chars[start])) start--;
          const keyword = chars.slice(start + 1, end + 1).join('');
          return /^(?:catch|for|if|switch|while|with)$/.test(keyword);
        }
      }
    }
    return false;
  }

  function startsRegex(index) {
    let previous = index - 1;
    while (previous >= 0 && /\s/.test(source[previous])) previous--;
    if (previous < 0 || /[([{:;,=!?&|+*%^~<>-]/.test(source[previous])) return true;
    if (source[previous] === ')' && followsControlCondition(previous)) return true;

    const prefix = source.slice(0, previous + 1);
    const keyword = prefix.match(/([A-Za-z_$][\w$]*)$/);
    return Boolean(keyword && /^(?:await|case|delete|do|else|in|instanceof|new|of|return|throw|typeof|void|yield)$/.test(keyword[1]));
  }

  function mask(index) {
    if (chars[index] !== '\n' && chars[index] !== '\r') chars[index] = ' ';
  }

  for (let i = 0; i < chars.length; i++) {
    const current = chars[i];
    const next = chars[i + 1];

    if (state === 'code') {
      if (current === '/' && next === '/') {
        mask(i);
        mask(i + 1);
        i++;
        state = 'line-comment';
      } else if (current === '/' && next === '*') {
        mask(i);
        mask(i + 1);
        i++;
        state = 'block-comment';
      } else if (current === "'") {
        mask(i);
        state = 'single-quote';
      } else if (current === '"') {
        mask(i);
        state = 'double-quote';
      } else if (current === '`') {
        mask(i);
        state = 'template';
      } else if (current === '/' && startsRegex(i)) {
        mask(i);
        state = 'regex';
      } else if (templateExpressionDepths.length > 0 && current === '{') {
        templateExpressionDepths[templateExpressionDepths.length - 1]++;
      } else if (templateExpressionDepths.length > 0 && current === '}') {
        const last = templateExpressionDepths.length - 1;
        if (templateExpressionDepths[last] === 0) {
          mask(i);
          templateExpressionDepths.pop();
          state = 'template';
        } else {
          templateExpressionDepths[last]--;
        }
      }
      continue;
    }

    if (state === 'line-comment') {
      mask(i);
      if (current === '\n' || current === '\r') state = 'code';
      continue;
    }

    if (state === 'block-comment') {
      mask(i);
      if (current === '*' && next === '/') {
        mask(i + 1);
        i++;
        state = 'code';
      }
      continue;
    }

    if (state === 'regex') {
      mask(i);
      if (current === '\\') {
        if (i + 1 < chars.length) {
          mask(i + 1);
          i++;
        }
      } else if (current === '[') {
        state = 'regex-class';
      } else if (current === '/') {
        state = 'code';
      }
      continue;
    }

    if (state === 'regex-class') {
      mask(i);
      if (current === '\\') {
        if (i + 1 < chars.length) {
          mask(i + 1);
          i++;
        }
      } else if (current === ']') {
        state = 'regex';
      }
      continue;
    }

    if (state === 'template') {
      mask(i);
      if (current === '\\') {
        if (i + 1 < chars.length) {
          mask(i + 1);
          i++;
        }
      } else if (current === '`') {
        state = 'code';
      } else if (current === '$' && next === '{') {
        mask(i + 1);
        i++;
        templateExpressionDepths.push(0);
        state = 'code';
      }
      continue;
    }

    mask(i);
    if (current === '\\') {
      if (i + 1 < chars.length) {
        mask(i + 1);
        i++;
      }
      continue;
    }
    if (
      (state === 'single-quote' && current === "'") ||
      (state === 'double-quote' && current === '"')
    ) {
      state = 'code';
    }
  }

  return chars.join('');
}

function collectHelperReferences(files) {
  const definitions = new Set();
  const calls = new Set();

  files.forEach((file) => {
    const source = maskCommentsAndStrings(fs.readFileSync(file, 'utf8'));

    for (const match of source.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g)) {
      definitions.add(match[1]);
    }

    for (const match of source.matchAll(/\b([A-Za-z_$][\w$]*_)\s*\(/g)) {
      let previous = match.index - 1;
      while (previous >= 0 && /\s/.test(source[previous])) previous--;
      if (source[previous] !== '.') calls.add(match[1]);
    }
  });

  return {
    definitions,
    calls,
    missing: [...calls].filter((name) => !definitions.has(name)).sort(),
  };
}

test('ignores helper-like text outside executable code', () => {
  const audit = collectHelperReferences([
    fixturePath('undefined-helpers-clean.js'),
  ]);

  assert.deepEqual([...audit.calls].sort(), ['declared_fixture_']);
  assert.deepEqual(audit.missing, []);
});

test('detects a missing helper in a template expression but ignores raw template text', () => {
  const audit = collectHelperReferences([
    fixturePath('undefined-helpers-template-expression.js'),
  ]);

  assert.deepEqual([...audit.calls].sort(), ['missing_template_']);
  assert.deepEqual(audit.missing, ['missing_template_']);
});

test('detects a missing helper in nested template expressions and nested braces', () => {
  const audit = collectHelperReferences([
    fixturePath('undefined-helpers-nested-template.js'),
  ]);

  assert.deepEqual([...audit.calls].sort(), [
    'missing_nested_template_',
    'wrapper_fixture_',
  ]);
  assert.deepEqual(audit.missing, ['missing_nested_template_']);
});

test('every bare internal helper call has a global function declaration', () => {
  const files = fs.readdirSync(srcDir)
    .filter((name) => name.endsWith('.js'))
    .sort()
    .map((name) => path.join(srcDir, name));
  const audit = collectHelperReferences(files);

  assert.equal(files.length > 0, true, 'No src/*.js files were found');
  assert.equal(
    audit.missing.length,
    0,
    'Undefined internal helper calls: ' + audit.missing.join(', ')
  );
});
