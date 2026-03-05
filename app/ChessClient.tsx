"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChessSideConfigPanel } from "../components/chess/SideConfigPanel";
import { createInitialConversations, sideToConversationKey } from "../lib/chess/conversation";
import { pickChessFallbackMove } from "../lib/chess/fallback";
import {
  applyMove,
  BLACK_SIDE,
  boardToCompactText,
  createInitialBoard,
  formatMoveText,
  generateCandidateMoves,
  isLegalMove,
  oppositeSide,
  pieceLabel,
  pieceShort,
  resolveWinner,
  sideLabel,
  WHITE_SIDE,
} from "../lib/chess/game";
import { parseChessMoveFromLLMText } from "../lib/chess/move-parser";
import { buildChessMovePrompt } from "../lib/chess/prompt";
import type {
  ChessBoard,
  ChessConversations,
  ChessMove,
  ChessMoveCommitMeta,
  ChessMoveHistoryItem,
  ChessPiece,
  ChessSide,
} from "../lib/chess/types";
import { requestLLMCompletion } from "../lib/gomoku/llm-client";
import type { EffectiveSideConfig, LLMProxyPayload, SideConfigInput } from "../lib/gomoku/types";
import { useSharedSideLLMConfig } from "../lib/hooks/use-shared-side-llm-config";

const AI_CONFIG_STORAGE_KEYS = {
  black: "chess:ai:black",
  white: "chess:ai:white",
} as const;

interface ChessBoardMove extends ChessMove {
  side: ChessSide;
}

function pieceToken(piece: ChessPiece): string {
  return pieceShort(piece.kind);
}

export default function ChessClient() {
  const [board, setBoard] = useState<ChessBoard>(() => createInitialBoard());
  const [currentSide, setCurrentSide] = useState<ChessSide>(WHITE_SIDE);
  const [gameOver, setGameOver] = useState<boolean>(false);
  const [winner, setWinner] = useState<ChessSide | "draw" | null>(null);
  const [lastMove, setLastMove] = useState<ChessBoardMove | null>(null);
  const [lastReason, setLastReason] = useState<string>("");
  const [thinking, setThinking] = useState<boolean>(false);
  const [started, setStarted] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  const {
    blackConfig: blackAI,
    whiteConfig: whiteAI,
    setBlackConfig: setBlackAI,
    setWhiteConfig: setWhiteAI,
  } = useSharedSideLLMConfig({
    blackStorageKey: AI_CONFIG_STORAGE_KEYS.black,
    whiteStorageKey: AI_CONFIG_STORAGE_KEYS.white,
  });

  const [speedMs, setSpeedMs] = useState<number>(320);
  const [stats, setStats] = useState({ white: 0, black: 0, draw: 0 });
  const [moveHistory, setMoveHistory] = useState<ChessMoveHistoryItem[]>([]);
  const [aiConversations, setAiConversations] = useState<ChessConversations>(() =>
    createInitialConversations(),
  );
  const boardRef = useRef<ChessBoard>(board);
  const aiConversationsRef = useRef<ChessConversations>(aiConversations);

  useEffect(() => {
    boardRef.current = board;
  }, [board]);

  useEffect(() => {
    aiConversationsRef.current = aiConversations;
  }, [aiConversations]);

  const effectiveConfig = useMemo<{ white: EffectiveSideConfig; black: EffectiveSideConfig }>(() => {
    const build = (input: SideConfigInput): EffectiveSideConfig => {
      const apiUrl = input.apiUrl.trim();
      const model = input.model.trim();
      const ready = Boolean(apiUrl && model && input.apiKey.trim());
      return {
        model,
        ready,
      };
    };

    return {
      white: build(whiteAI),
      black: build(blackAI),
    };
  }, [blackAI, whiteAI]);

  const activeModel = currentSide === WHITE_SIDE ? effectiveConfig.white.model : effectiveConfig.black.model;
  const currentSideReady = currentSide === WHITE_SIDE ? effectiveConfig.white.ready : effectiveConfig.black.ready;

  const whiteThoughts = useMemo(
    () =>
      moveHistory
        .filter((item) => item.side === WHITE_SIDE && item.thinking)
        .slice(-12)
        .reverse(),
    [moveHistory],
  );

  const blackThoughts = useMemo(
    () =>
      moveHistory
        .filter((item) => item.side === BLACK_SIDE && item.thinking)
        .slice(-12)
        .reverse(),
    [moveHistory],
  );

  const recentMoves = useMemo(() => moveHistory.slice(-10).reverse(), [moveHistory]);

  const restartGame = useCallback(() => {
    setBoard(createInitialBoard());
    setCurrentSide(WHITE_SIDE);
    setGameOver(false);
    setWinner(null);
    setLastMove(null);
    setLastReason("");
    setThinking(false);
    setStarted(false);
    setError("");
    setMoveHistory([]);
    setAiConversations(createInitialConversations());
  }, []);

  const clearStats = useCallback(() => {
    setStats({ white: 0, black: 0, draw: 0 });
  }, []);

  const commitMove = useCallback(
    (
      baseBoard: ChessBoard,
      move: ChessMove,
      side: ChessSide,
      meta: ChessMoveCommitMeta = {},
    ): boolean => {
      const movingPiece = baseBoard[move.fromRow][move.fromCol];
      if (!movingPiece) {
        return false;
      }

      const result = applyMove(baseBoard, move, side);
      if (!result) {
        return false;
      }

      const nextBoard = result.board;
      const moveReason = meta.reason || "";
      const moveText = formatMoveText(movingPiece, move, result.promoted);
      const capturedText = result.captured ? pieceLabel(result.captured) : "";

      setBoard(nextBoard);
      setLastMove({
        fromRow: move.fromRow,
        fromCol: move.fromCol,
        toRow: move.toRow,
        toCol: move.toCol,
        side,
      });
      setLastReason(moveReason);
      setMoveHistory((prev) => [
        ...prev,
        {
          turn: prev.length + 1,
          side,
          fromRow: move.fromRow,
          fromCol: move.fromCol,
          toRow: move.toRow,
          toCol: move.toCol,
          moveText,
          capturedText,
          reason: moveReason,
          thinking: meta.thinking || "",
          model: meta.model || "",
        },
      ]);

      const nextSide = oppositeSide(side);
      const winnerSide = resolveWinner(nextBoard, nextSide);
      if (winnerSide) {
        setGameOver(true);
        setWinner(winnerSide);
        setStats((prev) => {
          if (winnerSide === WHITE_SIDE) {
            return { ...prev, white: prev.white + 1 };
          }
          if (winnerSide === BLACK_SIDE) {
            return { ...prev, black: prev.black + 1 };
          }
          return { ...prev, draw: prev.draw + 1 };
        });
        return true;
      }

      if (moveHistory.length + 1 >= 260) {
        setGameOver(true);
        setWinner("draw");
        setStats((prev) => ({ ...prev, draw: prev.draw + 1 }));
        return true;
      }

      setCurrentSide(nextSide);
      return true;
    },
    [moveHistory.length],
  );

  useEffect(() => {
    if (gameOver || !started) {
      return;
    }

    if (!currentSideReady) {
      setError(`${sideLabel(currentSide)}未配置完整的 API URL / Model / API Key`);
      setThinking(false);
      return;
    }

    const side = currentSide;
    const currentBoard = board;
    const currentHistory = moveHistory;
    const sideInput = side === WHITE_SIDE ? whiteAI : blackAI;
    const convKey = sideToConversationKey(side);
    const currentConversation = aiConversationsRef.current[convKey];
    const controller = new AbortController();
    let active = true;

    const timerId = setTimeout(async () => {
      const candidates = generateCandidateMoves(currentBoard, side, 28);
      const fallback = pickChessFallbackMove(candidates);

      if (candidates.length === 0) {
        const resolved = resolveWinner(currentBoard, side);
        if (!active || controller.signal.aborted) {
          return;
        }

        setGameOver(true);
        setWinner(resolved || "draw");
        setStats((prev) => {
          if (resolved === WHITE_SIDE) {
            return { ...prev, white: prev.white + 1 };
          }
          if (resolved === BLACK_SIDE) {
            return { ...prev, black: prev.black + 1 };
          }
          return { ...prev, draw: prev.draw + 1 };
        });
        return;
      }

      setThinking(true);
      setError("");

      try {
        const prompt = buildChessMovePrompt({
          board: currentBoard,
          side,
          moveHistory: currentHistory,
          candidates,
        });
        const turnUserMessage = { role: "user" as const, content: prompt };
        const payload: LLMProxyPayload = {
          llm: {
            baseURL: sideInput.apiUrl.trim(),
            model: sideInput.model.trim(),
            apiKey: sideInput.apiKey.trim(),
            temperature: 0.2,
          },
          messages: [...currentConversation, turnUserMessage],
        };

        const data = await requestLLMCompletion(payload, controller.signal);
        const parsed = parseChessMoveFromLLMText(data.text);
        const assistantMessage = { role: "assistant" as const, content: data.text };

        setAiConversations((prev) => ({
          ...prev,
          [convKey]: [...prev[convKey], turnUserMessage, assistantMessage],
        }));

        if (!active || controller.signal.aborted) {
          return;
        }

        const liveBoard = boardRef.current;
        if (liveBoard !== currentBoard) {
          return;
        }

        let selected = parsed;
        if (!selected || !isLegalMove(liveBoard, selected, side)) {
          if (!fallback) {
            throw new Error("没有可用合法走法");
          }

          selected = {
            ...fallback,
            reason: "LLM输出无效，使用前端保底候选",
            thinking: parsed?.thinking || "",
          };
          setError("LLM输出非法，已使用前端保底走法");
        }

        commitMove(liveBoard, selected, side, {
          reason: selected.reason || "LLM走子",
          thinking: selected.thinking || "",
          model: data.model || sideInput.model,
        });
      } catch (err) {
        if (controller.signal.aborted) {
          return;
        }
        const message = err instanceof Error ? err.message : "未知错误";
        setError(`LLM调用失败：${message}`);
      } finally {
        if (!controller.signal.aborted) {
          setThinking(false);
        }
      }
    }, speedMs);

    return () => {
      active = false;
      clearTimeout(timerId);
      controller.abort();
    };
  }, [
    blackAI,
    board,
    commitMove,
    currentSide,
    currentSideReady,
    gameOver,
    moveHistory,
    speedMs,
    started,
    whiteAI,
  ]);

  const statusText = useMemo(() => {
    if (gameOver) {
      if (winner === "draw") {
        return "和棋";
      }
      if (winner) {
        return `${sideLabel(winner)}获胜`;
      }
      return "对局结束";
    }

    if (!started) {
      if (!effectiveConfig.white.ready || !effectiveConfig.black.ready) {
        return "请先配置黑白双方 API URL / Model / API Key，然后点击开始对战";
      }
      return "已就绪，点击“开始对战”";
    }

    if (thinking) {
      return `${sideLabel(currentSide)}（${activeModel}）思考中...`;
    }

    if (!currentSideReady) {
      return `${sideLabel(currentSide)}未配置完整参数`;
    }

    return `${sideLabel(currentSide)}（${activeModel}）等待走子`;
  }, [
    activeModel,
    currentSide,
    currentSideReady,
    effectiveConfig.black.ready,
    effectiveConfig.white.ready,
    gameOver,
    started,
    thinking,
    winner,
  ]);

  const boardSummary = useMemo(() => boardToCompactText(board), [board]);

  return (
    <main className="app">
      <ChessSideConfigPanel
        sideName="白方"
        config={whiteAI}
        effective={effectiveConfig.white}
        thoughts={whiteThoughts}
        isThinking={started && !gameOver && currentSide === WHITE_SIDE && thinking}
        onChange={(patch) => setWhiteAI((prev) => ({ ...prev, ...patch }))}
      />

      <section className="centerPanel chessCenterPanel">
        <h1>国际象棋 · 双 LLM 对战</h1>
        <p className="sub">白方先手，黑白双方均由 LLM 控制</p>

        <div className="xiangqiMetaBar">
          <span className={`sideChip white ${!gameOver && currentSide === WHITE_SIDE ? "active" : ""}`}>
            白方
          </span>
          <span
            className={`sideChip black ${!gameOver && currentSide === BLACK_SIDE ? "active" : ""}`}
          >
            黑方
          </span>
          <span className="turnChip">总手数 {moveHistory.length}</span>
        </div>

        <div className="centerControls">
          <label>
            每步间隔（毫秒）
            <input
              type="range"
              min="180"
              max="1800"
              step="20"
              value={speedMs}
              onChange={(event) => setSpeedMs(Number(event.target.value))}
            />
            <span>{speedMs}</span>
          </label>

          <div className="chessHintCard">
            <p>坐标说明：row 0-7，col 0-7</p>
            <p>白方后排在 row 7，黑方后排在 row 0</p>
            <p>点击“开始对战”后自动轮流走子</p>
          </div>
        </div>

        <div className="actions">
          <button onClick={() => setStarted(true)} disabled={started || gameOver}>
            开始对战
          </button>
          <button onClick={restartGame}>重新开始</button>
          <button className="ghost" onClick={clearStats}>
            清空战绩
          </button>
        </div>

        <p className="status">{statusText}</p>
        {lastReason ? <p className="reason">上一步理由：{lastReason}</p> : null}
        {error ? <p className="error">{error}</p> : null}

        <div className="boardWrap">
          <div className="chessBoard" role="img" aria-label="国际象棋棋盘">
            {board.map((row, rowIndex) => (
              <div key={`row-${rowIndex}`} className="chessRow">
                {row.map((piece, colIndex) => {
                  const dark = (rowIndex + colIndex) % 2 === 1;
                  const isLast =
                    !!lastMove &&
                    ((lastMove.fromRow === rowIndex && lastMove.fromCol === colIndex) ||
                      (lastMove.toRow === rowIndex && lastMove.toCol === colIndex));

                  const className = [
                    "chessCell",
                    dark ? "dark" : "light",
                    isLast ? "last" : "",
                  ]
                    .filter(Boolean)
                    .join(" ");

                  return (
                    <div key={`cell-${rowIndex}-${colIndex}`} className={className}>
                      {piece ? (
                        <span className={`chessPieceToken ${piece.side}`}>{pieceToken(piece)}</span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        <div className="stats">
          <div>
            <span>白胜</span>
            <strong>{stats.white}</strong>
          </div>
          <div>
            <span>黑胜</span>
            <strong>{stats.black}</strong>
          </div>
          <div>
            <span>平局</span>
            <strong>{stats.draw}</strong>
          </div>
        </div>

        <details className="summary">
          <summary>当前棋局摘要（发送给 LLM）</summary>
          <p>白方棋子：{boardSummary.white || "无"}</p>
          <p>黑方棋子：{boardSummary.black || "无"}</p>
          <p>总手数：{moveHistory.length}</p>
        </details>

        <details className="summary xiangqiTrail">
          <summary>最近走子</summary>
          {recentMoves.length === 0 ? (
            <p>暂无走子记录</p>
          ) : (
            <div className="moveTrail">
              {recentMoves.map((item) => (
                <p key={`${item.turn}-${item.fromRow}-${item.fromCol}-${item.toRow}-${item.toCol}`}>
                  第 {item.turn} 手 · {sideLabel(item.side)} · {item.moveText}
                  {item.capturedText ? ` · 吃 ${item.capturedText}` : ""}
                </p>
              ))}
            </div>
          )}
        </details>
      </section>

      <ChessSideConfigPanel
        sideName="黑方"
        config={blackAI}
        effective={effectiveConfig.black}
        thoughts={blackThoughts}
        isThinking={started && !gameOver && currentSide === BLACK_SIDE && thinking}
        onChange={(patch) => setBlackAI((prev) => ({ ...prev, ...patch }))}
      />
    </main>
  );
}
