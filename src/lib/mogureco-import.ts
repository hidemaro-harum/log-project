export type MogurecoImportRecord = {
  name: string;
  visitedAt: string | null;
  rating: number | null;
  memo: string;
  tags: string[];
  address: string;
};

export type MogurecoImportParseResult = {
  records: MogurecoImportRecord[];
  errors: string[];
};

const REQUIRED_HEADERS = ["店舗名", "訪問日", "評価", "メモ", "タグ", "住所"] as const;

export function parseMogurecoCsv(csvText: string): MogurecoImportParseResult {
  const rows = parseCsvRows(csvText.replace(/^\uFEFF/, ""));
  const [headers, ...dataRows] = rows;

  if (!headers?.length) {
    return { records: [], errors: ["CSVが空です。"] };
  }

  const missingHeaders = REQUIRED_HEADERS.filter((header) => !headers.includes(header));
  if (missingHeaders.length) {
    return { records: [], errors: [`CSVに必要な列がありません: ${missingHeaders.join(", ")}`] };
  }

  const indexes = Object.fromEntries(REQUIRED_HEADERS.map((header) => [header, headers.indexOf(header)])) as Record<typeof REQUIRED_HEADERS[number], number>;
  const records: MogurecoImportRecord[] = [];
  const errors: string[] = [];

  dataRows.forEach((row, rowIndex) => {
    if (row.every((cell) => !cell.trim())) return;

    const line = rowIndex + 2;
    const name = valueAt(row, indexes["店舗名"]);
    const visitedAt = valueAt(row, indexes["訪問日"]);
    const ratingText = valueAt(row, indexes["評価"]);
    const memo = valueAt(row, indexes["メモ"]);
    const tagText = valueAt(row, indexes["タグ"]);
    const address = valueAt(row, indexes["住所"]);

    if (!name) {
      errors.push(`${line}行目: 店舗名が空です。`);
      return;
    }

    if (visitedAt && !/^\d{4}-\d{2}-\d{2}$/.test(visitedAt)) {
      errors.push(`${line}行目: 訪問日がYYYY-MM-DD形式ではありません。`);
      return;
    }

    const rating = parseRating(ratingText);
    if (ratingText && rating === null) {
      errors.push(`${line}行目: 評価は0.5から5の数値で入力してください。`);
      return;
    }

    records.push({
      name,
      visitedAt: visitedAt || null,
      rating,
      memo,
      tags: splitTags(tagText),
      address,
    });
  });

  return { records, errors };
}

function valueAt(row: string[], index: number) {
  return (row[index] ?? "").trim();
}

function parseRating(value: string) {
  if (!value) return null;
  const rating = Number(value);
  if (!Number.isFinite(rating) || rating < 0.5 || rating > 5) return null;
  return rating;
}

function splitTags(value: string) {
  return value.split(/[、,\s]+/).map((tag) => tag.trim()).filter(Boolean);
}

function parseCsvRows(csvText: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < csvText.length; index += 1) {
    const char = csvText[index];
    const next = csvText[index + 1];

    if (char === "\"") {
      if (quoted && next === "\"") {
        field += "\"";
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (char === "," && !quoted) {
      row.push(field);
      field = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }

    field += char;
  }

  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}
