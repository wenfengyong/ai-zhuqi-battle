import type {
  ChessBoard,
  ChessCandidateMove,
  ChessCompactBoardText,
  ChessMove,
  ChessMoveResult,
  ChessPiece,
  ChessPieceKind,
  ChessSide,
} from "./types";
import { CHESS_SIZE } from "./types";

export const WHITE_SIDE: ChessSide = "white";
export const BLACK_SIDE: ChessSide = "black";

const ORTHOGONAL_DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

const DIAGONAL_DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

const KNIGHT_JUMPS: ReadonlyArray<readonly [number, number]> = [
  [-2, -1],
  [-2, 1],
  [-1, -2],
  [-1, 2],
  [1, -2],
  [1, 2],
  [2, -1],
  [2, 1],
];

const KING_JUMPS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1],
  [-1, 0],
  [-1, 1],
  [0, -1],
  [0, 1],
  [1, -1],
  [1, 0],
  [1, 1],
];

const PIECE_VALUES: Record<ChessPieceKind, number> = {
  k: 100000,
  q: 900,
  r: 500,
  b: 320,
  n: 300,
  p: 100,
};

const FILES = "abcdefgh";

export function createInitialBoard(): ChessBoard {
  const board: ChessBoard = Array.from({ length: CHESS_SIZE }, () =>
    Array.from({ length: CHESS_SIZE }, () => null as ChessPiece | null),
  );

  const put = (row: number, col: number, side: ChessSide, kind: ChessPieceKind) => {
    board[row][col] = {
      side,
      kind,
      moved: false,
    };
  };

  const backRank: ChessPieceKind[] = ["r", "n", "b", "q", "k", "b", "n", "r"];
  for (let col = 0; col < CHESS_SIZE; col += 1) {
    put(0, col, BLACK_SIDE, backRank[col]);
    put(1, col, BLACK_SIDE, "p");
    put(6, col, WHITE_SIDE, "p");
    put(7, col, WHITE_SIDE, backRank[col]);
  }

  return board;
}

export function cloneBoard(board: ChessBoard): ChessBoard {
  return board.map((row) => row.map((piece) => (piece ? { ...piece } : null)));
}

export function inBounds(row: number, col: number): boolean {
  return row >= 0 && row < CHESS_SIZE && col >= 0 && col < CHESS_SIZE;
}

export function oppositeSide(side: ChessSide): ChessSide {
  return side === WHITE_SIDE ? BLACK_SIDE : WHITE_SIDE;
}

export function sideLabel(side: ChessSide): string {
  return side === WHITE_SIDE ? "白方" : "黑方";
}

export function pieceShort(kind: ChessPieceKind): string {
  if (kind === "k") {
    return "K";
  }
  if (kind === "q") {
    return "Q";
  }
  if (kind === "r") {
    return "R";
  }
  if (kind === "b") {
    return "B";
  }
  if (kind === "n") {
    return "N";
  }
  return "P";
}

export function pieceLabel(piece: ChessPiece): string {
  const map: Record<ChessPieceKind, string> = {
    k: "王",
    q: "后",
    r: "车",
    b: "象",
    n: "马",
    p: "兵",
  };
  return map[piece.kind];
}

export function squareText(row: number, col: number): string {
  if (!inBounds(row, col)) {
    return `${row},${col}`;
  }
  return `${FILES[col]}${8 - row}`;
}

export function formatMoveText(piece: ChessPiece, move: ChessMove, promoted: boolean): string {
  const promoText = promoted ? "=Q" : "";
  return `${pieceShort(piece.kind)} ${squareText(move.fromRow, move.fromCol)}→${squareText(move.toRow, move.toCol)}${promoText}`;
}

function canOccupy(board: ChessBoard, row: number, col: number, side: ChessSide): boolean {
  if (!inBounds(row, col)) {
    return false;
  }
  const target = board[row][col];
  return !target || target.side !== side;
}

function pawnDirection(side: ChessSide): number {
  return side === WHITE_SIDE ? -1 : 1;
}

function pawnStartRow(side: ChessSide): number {
  return side === WHITE_SIDE ? 6 : 1;
}

function promotionRow(side: ChessSide): number {
  return side === WHITE_SIDE ? 0 : 7;
}

function isSameMove(a: ChessMove, b: ChessMove): boolean {
  return (
    a.fromRow === b.fromRow &&
    a.fromCol === b.fromCol &&
    a.toRow === b.toRow &&
    a.toCol === b.toCol
  );
}

function addSlidingMoves(
  board: ChessBoard,
  row: number,
  col: number,
  side: ChessSide,
  dirs: ReadonlyArray<readonly [number, number]>,
  moves: ChessMove[],
) {
  for (const [dr, dc] of dirs) {
    let r = row + dr;
    let c = col + dc;
    while (inBounds(r, c)) {
      const target = board[r][c];
      if (!target) {
        moves.push({ fromRow: row, fromCol: col, toRow: r, toCol: c });
      } else {
        if (target.side !== side) {
          moves.push({ fromRow: row, fromCol: col, toRow: r, toCol: c });
        }
        break;
      }
      r += dr;
      c += dc;
    }
  }
}

function findKing(board: ChessBoard, side: ChessSide): { row: number; col: number } | null {
  for (let row = 0; row < CHESS_SIZE; row += 1) {
    for (let col = 0; col < CHESS_SIZE; col += 1) {
      const piece = board[row][col];
      if (piece && piece.side === side && piece.kind === "k") {
        return { row, col };
      }
    }
  }
  return null;
}

function attacksBySlidingPiece(
  board: ChessBoard,
  fromRow: number,
  fromCol: number,
  targetRow: number,
  targetCol: number,
  dirs: ReadonlyArray<readonly [number, number]>,
): boolean {
  for (const [dr, dc] of dirs) {
    let row = fromRow + dr;
    let col = fromCol + dc;
    while (inBounds(row, col)) {
      if (row === targetRow && col === targetCol) {
        return true;
      }
      if (board[row][col]) {
        break;
      }
      row += dr;
      col += dc;
    }
  }
  return false;
}

function isSquareAttacked(
  board: ChessBoard,
  targetRow: number,
  targetCol: number,
  attacker: ChessSide,
): boolean {
  for (let row = 0; row < CHESS_SIZE; row += 1) {
    for (let col = 0; col < CHESS_SIZE; col += 1) {
      const piece = board[row][col];
      if (!piece || piece.side !== attacker) {
        continue;
      }

      if (piece.kind === "p") {
        const dir = pawnDirection(attacker);
        if (row + dir === targetRow && (col - 1 === targetCol || col + 1 === targetCol)) {
          return true;
        }
        continue;
      }

      if (piece.kind === "n") {
        for (const [dr, dc] of KNIGHT_JUMPS) {
          if (row + dr === targetRow && col + dc === targetCol) {
            return true;
          }
        }
        continue;
      }

      if (piece.kind === "b") {
        if (attacksBySlidingPiece(board, row, col, targetRow, targetCol, DIAGONAL_DIRS)) {
          return true;
        }
        continue;
      }

      if (piece.kind === "r") {
        if (attacksBySlidingPiece(board, row, col, targetRow, targetCol, ORTHOGONAL_DIRS)) {
          return true;
        }
        continue;
      }

      if (piece.kind === "q") {
        if (
          attacksBySlidingPiece(board, row, col, targetRow, targetCol, DIAGONAL_DIRS) ||
          attacksBySlidingPiece(board, row, col, targetRow, targetCol, ORTHOGONAL_DIRS)
        ) {
          return true;
        }
        continue;
      }

      for (const [dr, dc] of KING_JUMPS) {
        if (row + dr === targetRow && col + dc === targetCol) {
          return true;
        }
      }
    }
  }

  return false;
}

export function isInCheck(board: ChessBoard, side: ChessSide): boolean {
  const king = findKing(board, side);
  if (!king) {
    return true;
  }
  return isSquareAttacked(board, king.row, king.col, oppositeSide(side));
}

function canCastle(
  board: ChessBoard,
  side: ChessSide,
  kingRow: number,
  kingCol: number,
  rookCol: number,
): boolean {
  const rook = board[kingRow][rookCol];
  if (!rook || rook.side !== side || rook.kind !== "r" || rook.moved) {
    return false;
  }

  const step = rookCol > kingCol ? 1 : -1;

  for (let col = kingCol + step; col !== rookCol; col += step) {
    if (board[kingRow][col]) {
      return false;
    }
  }

  const enemy = oppositeSide(side);
  for (let col = kingCol; col !== kingCol + step * 3; col += step) {
    if (Math.abs(col - kingCol) > 2) {
      break;
    }
    if (isSquareAttacked(board, kingRow, col, enemy)) {
      return false;
    }
  }

  return true;
}

export function generatePseudoMovesForPiece(
  board: ChessBoard,
  row: number,
  col: number,
  piece: ChessPiece,
): ChessMove[] {
  const moves: ChessMove[] = [];

  if (piece.kind === "p") {
    const dir = pawnDirection(piece.side);
    const oneRow = row + dir;

    if (inBounds(oneRow, col) && !board[oneRow][col]) {
      moves.push({ fromRow: row, fromCol: col, toRow: oneRow, toCol: col });

      const twoRow = row + dir * 2;
      if (row === pawnStartRow(piece.side) && inBounds(twoRow, col) && !board[twoRow][col]) {
        moves.push({ fromRow: row, fromCol: col, toRow: twoRow, toCol: col });
      }
    }

    for (const dc of [-1, 1] as const) {
      const toRow = row + dir;
      const toCol = col + dc;
      if (!inBounds(toRow, toCol)) {
        continue;
      }
      const target = board[toRow][toCol];
      if (target && target.side !== piece.side) {
        moves.push({ fromRow: row, fromCol: col, toRow, toCol });
      }
    }

    return moves;
  }

  if (piece.kind === "n") {
    for (const [dr, dc] of KNIGHT_JUMPS) {
      const toRow = row + dr;
      const toCol = col + dc;
      if (!canOccupy(board, toRow, toCol, piece.side)) {
        continue;
      }
      moves.push({ fromRow: row, fromCol: col, toRow, toCol });
    }
    return moves;
  }

  if (piece.kind === "b") {
    addSlidingMoves(board, row, col, piece.side, DIAGONAL_DIRS, moves);
    return moves;
  }

  if (piece.kind === "r") {
    addSlidingMoves(board, row, col, piece.side, ORTHOGONAL_DIRS, moves);
    return moves;
  }

  if (piece.kind === "q") {
    addSlidingMoves(board, row, col, piece.side, DIAGONAL_DIRS, moves);
    addSlidingMoves(board, row, col, piece.side, ORTHOGONAL_DIRS, moves);
    return moves;
  }

  for (const [dr, dc] of KING_JUMPS) {
    const toRow = row + dr;
    const toCol = col + dc;
    if (!canOccupy(board, toRow, toCol, piece.side)) {
      continue;
    }
    moves.push({ fromRow: row, fromCol: col, toRow, toCol });
  }

  if (!piece.moved && !isInCheck(board, piece.side)) {
    if (canCastle(board, piece.side, row, col, 7)) {
      moves.push({ fromRow: row, fromCol: col, toRow: row, toCol: 6 });
    }
    if (canCastle(board, piece.side, row, col, 0)) {
      moves.push({ fromRow: row, fromCol: col, toRow: row, toCol: 2 });
    }
  }

  return moves;
}

function applyMoveUnchecked(board: ChessBoard, move: ChessMove): ChessMoveResult | null {
  if (!inBounds(move.fromRow, move.fromCol) || !inBounds(move.toRow, move.toCol)) {
    return null;
  }

  const moving = board[move.fromRow][move.fromCol];
  if (!moving) {
    return null;
  }

  const next = cloneBoard(board);
  const captured = next[move.toRow][move.toCol];
  let promoted = false;

  next[move.fromRow][move.fromCol] = null;

  const movedPiece: ChessPiece = {
    ...moving,
    moved: true,
  };

  if (movedPiece.kind === "p" && move.toRow === promotionRow(movedPiece.side)) {
    movedPiece.kind = "q";
    promoted = true;
  }

  next[move.toRow][move.toCol] = movedPiece;

  if (moving.kind === "k" && Math.abs(move.toCol - move.fromCol) === 2) {
    const rookFromCol = move.toCol > move.fromCol ? 7 : 0;
    const rookToCol = move.toCol > move.fromCol ? 5 : 3;
    const rook = next[move.toRow][rookFromCol];
    if (!rook || rook.kind !== "r" || rook.side !== moving.side) {
      return null;
    }
    next[move.toRow][rookFromCol] = null;
    next[move.toRow][rookToCol] = {
      ...rook,
      moved: true,
    };
  }

  return {
    board: next,
    captured: captured ? { ...captured } : null,
    promoted,
  };
}

export function isLegalMove(board: ChessBoard, move: ChessMove, side: ChessSide): boolean {
  if (!inBounds(move.fromRow, move.fromCol) || !inBounds(move.toRow, move.toCol)) {
    return false;
  }

  const piece = board[move.fromRow][move.fromCol];
  if (!piece || piece.side !== side) {
    return false;
  }

  const pseudo = generatePseudoMovesForPiece(board, move.fromRow, move.fromCol, piece);
  if (!pseudo.some((item) => isSameMove(item, move))) {
    return false;
  }

  const result = applyMoveUnchecked(board, move);
  if (!result) {
    return false;
  }

  return !isInCheck(result.board, side);
}

export function applyMove(board: ChessBoard, move: ChessMove, side: ChessSide): ChessMoveResult | null {
  if (!isLegalMove(board, move, side)) {
    return null;
  }
  return applyMoveUnchecked(board, move);
}

export function generateLegalMoves(board: ChessBoard, side: ChessSide): ChessMove[] {
  const moves: ChessMove[] = [];
  for (let row = 0; row < CHESS_SIZE; row += 1) {
    for (let col = 0; col < CHESS_SIZE; col += 1) {
      const piece = board[row][col];
      if (!piece || piece.side !== side) {
        continue;
      }
      const pseudo = generatePseudoMovesForPiece(board, row, col, piece);
      for (const move of pseudo) {
        if (isLegalMove(board, move, side)) {
          moves.push(move);
        }
      }
    }
  }
  return moves;
}

function evaluateMove(board: ChessBoard, move: ChessMove, side: ChessSide): number {
  const moving = board[move.fromRow][move.fromCol];
  if (!moving) {
    return -Infinity;
  }

  const result = applyMoveUnchecked(board, move);
  if (!result) {
    return -Infinity;
  }

  const captureScore = result.captured ? PIECE_VALUES[result.captured.kind] * 3.5 : 0;
  const promotionScore = result.promoted ? 800 : 0;

  const centerBonus =
    (3.5 - Math.abs(move.toRow - 3.5)) * 10 + (3.5 - Math.abs(move.toCol - 3.5)) * 10;

  let pieceBonus = 0;
  if (moving.kind === "n" || moving.kind === "b") {
    pieceBonus += centerBonus;
  } else if (moving.kind === "p") {
    const progress = side === WHITE_SIDE ? 6 - move.toRow : move.toRow - 1;
    pieceBonus += progress * 15;
  } else if (moving.kind === "k" && Math.abs(move.toCol - move.fromCol) === 2) {
    pieceBonus += 60;
  }

  let checkBonus = 0;
  if (isInCheck(result.board, oppositeSide(side))) {
    checkBonus += 150;
  }

  if (result.captured?.kind === "k") {
    checkBonus += 1_000_000;
  }

  return captureScore + promotionScore + pieceBonus + checkBonus;
}

export function generateCandidateMoves(
  board: ChessBoard,
  side: ChessSide,
  limit = 24,
): ChessCandidateMove[] {
  const legalMoves = generateLegalMoves(board, side);
  const scored = legalMoves.map((move) => ({
    ...move,
    score: evaluateMove(board, move, side),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

export function resolveWinner(board: ChessBoard, sideToMove: ChessSide): ChessSide | "draw" | null {
  const whiteKing = findKing(board, WHITE_SIDE);
  const blackKing = findKing(board, BLACK_SIDE);

  if (!whiteKing) {
    return BLACK_SIDE;
  }

  if (!blackKing) {
    return WHITE_SIDE;
  }

  const legal = generateLegalMoves(board, sideToMove);
  if (legal.length > 0) {
    return null;
  }

  if (isInCheck(board, sideToMove)) {
    return oppositeSide(sideToMove);
  }

  return "draw";
}

export function boardToMatrixText(board: ChessBoard): string {
  return board
    .map((row, rowIndex) => {
      const text = row
        .map((piece) => {
          if (!piece) {
            return "--";
          }
          return `${piece.side === WHITE_SIDE ? "w" : "b"}${piece.kind}`;
        })
        .join(" ");
      return `${String(rowIndex).padStart(2, "0")}: ${text}`;
    })
    .join("\n");
}

export function boardToCompactText(board: ChessBoard): ChessCompactBoardText {
  const white: string[] = [];
  const black: string[] = [];

  for (let row = 0; row < CHESS_SIZE; row += 1) {
    for (let col = 0; col < CHESS_SIZE; col += 1) {
      const piece = board[row][col];
      if (!piece) {
        continue;
      }
      const text = `${pieceShort(piece.kind)}(${squareText(row, col)})`;
      if (piece.side === WHITE_SIDE) {
        white.push(text);
      } else {
        black.push(text);
      }
    }
  }

  return {
    white: white.join(" "),
    black: black.join(" "),
  };
}
