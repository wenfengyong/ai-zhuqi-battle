export const CHESS_SIZE = 8;

export type ChessSide = "white" | "black";
export type ChessPieceKind = "k" | "q" | "r" | "b" | "n" | "p";

export interface ChessPiece {
  side: ChessSide;
  kind: ChessPieceKind;
  moved: boolean;
}

export type ChessBoard = Array<Array<ChessPiece | null>>;

export interface ChessMove {
  fromRow: number;
  fromCol: number;
  toRow: number;
  toCol: number;
}

export interface ChessMoveResult {
  board: ChessBoard;
  captured: ChessPiece | null;
  promoted: boolean;
}

export interface ChessCandidateMove extends ChessMove {
  score: number;
}

export interface ChessCompactBoardText {
  white: string;
  black: string;
}

export interface ChessMoveHistoryItem {
  turn: number;
  side: ChessSide;
  fromRow: number;
  fromCol: number;
  toRow: number;
  toCol: number;
  moveText: string;
  capturedText: string;
  reason: string;
  thinking: string;
  model: string;
}

export interface ChessMoveCommitMeta {
  reason?: string;
  thinking?: string;
  model?: string;
}

export interface ChessParsedMove extends ChessMove {
  reason: string;
  thinking: string;
}

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChessConversations {
  white: ChatMessage[];
  black: ChatMessage[];
}

export interface BuildChessPromptParams {
  board: ChessBoard;
  side: ChessSide;
  moveHistory: ChessMoveHistoryItem[];
  candidates: ChessCandidateMove[];
}
