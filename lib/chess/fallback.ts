import type { ChessCandidateMove, ChessMove } from "./types";

export function pickChessFallbackMove(candidates: ChessCandidateMove[]): ChessMove | null {
  if (candidates.length === 0) {
    return null;
  }

  const top = candidates[0];
  return {
    fromRow: top.fromRow,
    fromCol: top.fromCol,
    toRow: top.toRow,
    toCol: top.toCol,
  };
}
