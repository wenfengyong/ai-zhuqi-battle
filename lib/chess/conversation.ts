import { BLACK_SIDE, sideLabel, WHITE_SIDE } from "./game";
import type { ChatMessage, ChessConversations, ChessSide } from "./types";

export const CHESS_SYSTEM_PROMPT =
  "你是国际象棋引擎。必须仅输出JSON对象，不要markdown，不要额外解释，不要自然语言前后缀。";

function roleBootstrap(side: ChessSide): ChatMessage {
  const self = sideLabel(side);
  const enemy = sideLabel(side === WHITE_SIDE ? BLACK_SIDE : WHITE_SIDE);

  return {
    role: "user",
    content: [
      `你在本局中持续扮演${self}AI，对手是${enemy}。`,
      "这是同一局连续对话，每回合我会追加完整棋局状态与候选走法。",
      "坐标是 row(0-7), col(0-7)，row=0 为黑方后排，row=7 为白方后排。",
      "白方先手。必须返回：",
      '{"fromRow":6,"fromCol":4,"toRow":4,"toCol":4,"reason":"一句短理由","thinking":["步骤1","步骤2"]}',
    ].join("\n"),
  };
}

export function createInitialConversationFor(side: ChessSide): ChatMessage[] {
  return [
    {
      role: "system",
      content: CHESS_SYSTEM_PROMPT,
    },
    roleBootstrap(side),
  ];
}

export function createInitialConversations(): ChessConversations {
  return {
    white: createInitialConversationFor(WHITE_SIDE),
    black: createInitialConversationFor(BLACK_SIDE),
  };
}

export function sideToConversationKey(side: ChessSide): "white" | "black" {
  return side === WHITE_SIDE ? "white" : "black";
}
