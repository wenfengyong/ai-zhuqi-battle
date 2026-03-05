import { boardToMatrixText, sideLabel, squareText } from "./game";
import type { BuildChessPromptParams } from "./types";

function formatMove(rowA: number, colA: number, rowB: number, colB: number): string {
  return `${squareText(rowA, colA)}(${rowA},${colA})->${squareText(rowB, colB)}(${rowB},${colB})`;
}

export function buildChessMovePrompt(params: BuildChessPromptParams): string {
  const { board, side, moveHistory, candidates } = params;

  const last = moveHistory[moveHistory.length - 1];
  const lastText = last
    ? `第${last.turn}手 ${sideLabel(last.side)} ${formatMove(
        last.fromRow,
        last.fromCol,
        last.toRow,
        last.toCol,
      )}`
    : "无";

  const candidateText = candidates.length
    ? candidates
        .slice(0, 24)
        .map((move) => `${formatMove(move.fromRow, move.fromCol, move.toRow, move.toCol)} score=${Math.round(move.score)}`)
        .join(" ")
    : "无可用合法走法";

  return [
    `回合更新：当前你执${sideLabel(side)}，第 ${moveHistory.length + 1} 手。`,
    "请优先从候选走法中选择一手。",
    `上一手：${lastText}`,
    "棋盘矩阵（--为空；wp/wr/...是白方；bp/br/...是黑方）：",
    boardToMatrixText(board),
    `候选走法：${candidateText}`,
    "只返回JSON。",
  ].join("\n");
}
