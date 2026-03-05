import type { ChessParsedMove } from "./types";

const FILES = "abcdefgh";

function parseJSON(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeThinking(value: unknown): string {
  if (Array.isArray(value)) {
    return value
      .map((item) => cleanText(item))
      .filter(Boolean)
      .join("；")
      .slice(0, 420);
  }
  return cleanText(value).slice(0, 420);
}

function parseSquareText(value: string): { row: number; col: number } | null {
  const text = value.trim().toLowerCase();
  const match = text.match(/^([a-h])([1-8])$/);
  if (!match) {
    return null;
  }

  const col = FILES.indexOf(match[1]);
  const rank = Number(match[2]);
  if (col < 0 || !Number.isInteger(rank)) {
    return null;
  }

  return {
    row: 8 - rank,
    col,
  };
}

function parseCoordPair(value: unknown): { row: number; col: number } | null {
  if (Array.isArray(value) && value.length >= 2) {
    const row = Number(value[0]);
    const col = Number(value[1]);
    if (Number.isInteger(row) && Number.isInteger(col)) {
      return { row, col };
    }
  }

  if (value && typeof value === "object") {
    const obj = value as { row?: unknown; col?: unknown };
    const row = Number(obj.row);
    const col = Number(obj.col);
    if (Number.isInteger(row) && Number.isInteger(col)) {
      return { row, col };
    }
  }

  if (typeof value === "string") {
    const coordMatch = value.match(/^\s*(\d+)\s*[,，]\s*(\d+)\s*$/);
    if (coordMatch) {
      const row = Number(coordMatch[1]);
      const col = Number(coordMatch[2]);
      if (Number.isInteger(row) && Number.isInteger(col)) {
        return { row, col };
      }
    }

    const square = parseSquareText(value);
    if (square) {
      return square;
    }
  }

  return null;
}

function parseMoveText(value: unknown): { from: { row: number; col: number }; to: { row: number; col: number } } | null {
  if (typeof value !== "string") {
    return null;
  }

  const text = value.trim().toLowerCase();
  const match = text.match(/([a-h][1-8])\s*[-_> ]\s*([a-h][1-8])|^([a-h][1-8])([a-h][1-8])$/);
  if (!match) {
    return null;
  }

  const fromText = (match[1] || match[3] || "").trim();
  const toText = (match[2] || match[4] || "").trim();
  const from = parseSquareText(fromText);
  const to = parseSquareText(toText);
  if (!from || !to) {
    return null;
  }

  return { from, to };
}

export function parseChessMoveFromLLMText(rawText: string): ChessParsedMove | null {
  const cleaned = rawText
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "");

  const direct = parseJSON(cleaned);
  const source = direct || parseJSON(cleaned.match(/\{[\s\S]*\}/)?.[0] || "");
  if (!source || typeof source !== "object") {
    return null;
  }

  const payload = source as {
    fromRow?: unknown;
    fromCol?: unknown;
    toRow?: unknown;
    toCol?: unknown;
    from?: unknown;
    to?: unknown;
    move?: unknown;
    reason?: unknown;
    thinking?: unknown;
  };

  let fromRow = Number(payload.fromRow);
  let fromCol = Number(payload.fromCol);
  let toRow = Number(payload.toRow);
  let toCol = Number(payload.toCol);

  if (
    !Number.isInteger(fromRow) ||
    !Number.isInteger(fromCol) ||
    !Number.isInteger(toRow) ||
    !Number.isInteger(toCol)
  ) {
    const fromPair = parseCoordPair(payload.from);
    const toPair = parseCoordPair(payload.to);

    if (fromPair && toPair) {
      fromRow = fromPair.row;
      fromCol = fromPair.col;
      toRow = toPair.row;
      toCol = toPair.col;
    } else {
      const compactMove = parseMoveText(payload.move);
      if (!compactMove) {
        return null;
      }
      fromRow = compactMove.from.row;
      fromCol = compactMove.from.col;
      toRow = compactMove.to.row;
      toCol = compactMove.to.col;
    }
  }

  return {
    fromRow,
    fromCol,
    toRow,
    toCol,
    reason: cleanText(payload.reason).slice(0, 120),
    thinking: normalizeThinking(payload.thinking),
  };
}
