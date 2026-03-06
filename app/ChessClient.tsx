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

type GameModeType = "ai-vs-ai" | "single" | "pvp";

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

  // 游戏模式：ai-vs-ai（双 AI）、single（单人对 AI）、pvp（双人对战）
  const [gameMode, setGameMode] = useState<GameModeType>("ai-vs-ai");
  const [playerSide, setPlayerSide] = useState<ChessSide>(WHITE_SIDE);
  const [retryCount, setRetryCount] = useState<number>(0);
  const [retryKey, setRetryKey] = useState<number>(0);
  const [boardHistory, setBoardHistory] = useState<ChessBoard[]>([]);

  const {
    blackConfig: blackAI,
    whiteConfig: whiteAI,
    setBlackConfig: setBlackAI,
    setWhiteConfig: setWhiteAI,
  } = useSharedSideLLMConfig({
    blackStorageKey: AI_CONFIG_STORAGE_KEYS.black,
    whiteStorageKey: AI_CONFIG_STORAGE_KEYS.white,
  });

  // PvP 模式不需要 AI 配置，但需要知道当前玩家是否有合法配置（用于显示）
  const isPvP = gameMode === "pvp";
  const isSingle = gameMode === "single";
  const isAiVsAi = gameMode === "ai-vs-ai";

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
    setBoardHistory([]);
    setRetryCount(0);
    setRetryKey(0);
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

      // 保存当前棋盘到历史记录
      setBoardHistory((prev) => [...prev, baseBoard]);

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

  // 悔棋功能
  const undoMove = useCallback(() => {
    if (boardHistory.length === 0 || gameOver) {
      return;
    }

    // 单人模式下，需要回退两步（玩家和 AI 各一步）；PvP 和双 AI 模式回退一步
    const stepsToUndo = isSingle && started ? 2 : 1;
    const targetIndex = Math.max(0, boardHistory.length - stepsToUndo);

    const previousBoard = boardHistory[targetIndex];
    setBoard(previousBoard);
    setBoardHistory((prev) => prev.slice(0, targetIndex));

    // 恢复对应的移动历史
    const newMoveHistory = moveHistory.slice(0, targetIndex);
    setMoveHistory(newMoveHistory);

    // 恢复当前玩家
    const lastSide = newMoveHistory.length > 0 ? newMoveHistory[newMoveHistory.length - 1].side : WHITE_SIDE;
    setCurrentSide(oppositeSide(lastSide));

    // 恢复最后一步信息
    if (newMoveHistory.length > 0) {
      const last = newMoveHistory[newMoveHistory.length - 1];
      setLastMove({
        fromRow: last.fromRow,
        fromCol: last.fromCol,
        toRow: last.toRow,
        toCol: last.toCol,
        side: last.side,
      });
      setLastReason(last.reason || "");
    } else {
      setLastMove(null);
      setLastReason("");
    }

    // 恢复 AI 对话历史（仅单人模式需要）
    if (isSingle) {
      const newConversations = createInitialConversations();
      setAiConversations(newConversations);
    }
    setError("");
    setRetryCount(0);
  }, [boardHistory, gameOver, moveHistory, isSingle, started]);

  // 重试 AI 落子
  const retryAiMove = useCallback(() => {
    if (!error || gameOver) {
      return;
    }
    setRetryCount(0);
    setRetryKey((prev) => prev + 1);
    setError("");
  }, [error, gameOver]);

  useEffect(() => {
    if (gameOver || !started) {
      return;
    }

    // 单人模式：如果是玩家的回合，跳过 AI 逻辑
    // PvP 模式：不需要 AI 逻辑
    if ((isSingle && currentSide === playerSide) || isPvP) {
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
    isSingle,
    playerSide,
    isPvP,
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
      if (isSingle || isPvP) {
        return "请选择模式并点击开始对战";
      }
      if (!effectiveConfig.white.ready || !effectiveConfig.black.ready) {
        return "请先配置黑白双方 API URL / Model / API Key，然后点击开始对战";
      }
      return "已就绪，点击「开始对战」";
    }

    // 单人模式
    if (isSingle) {
      if (currentSide === playerSide) {
        return "轮到你了，点击棋盘走子";
      }
      if (thinking) {
        return `AI（${activeModel}）思考中...`;
      }
      return `AI（${activeModel}）等待走子`;
    }

    // PvP 模式
    if (isPvP) {
      return `轮到${sideLabel(currentSide)}，点击棋盘走子`;
    }

    // 双 AI 模式
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
    isSingle,
    isPvP,
    started,
    thinking,
    winner,
    playerSide,
  ]);

  const boardSummary = useMemo(() => boardToCompactText(board), [board]);

  // 存储选中位置的 ref
  const selectedPositionRef = useRef<{ row: number; col: number } | null>(null);

  // 处理棋盘格子点击
  const handleCellClick = useCallback((row: number, col: number) => {
    if ((!isSingle && !isPvP) || !started || gameOver) {
      return;
    }

    // 单人模式：只在玩家的回合响应点击
    // PvP 模式：双方都可以操作
    if (isSingle && currentSide !== playerSide) {
      return;
    }

    const clickedPiece = board[row][col];

    // 如果已经选中了棋子
    if (selectedPositionRef.current) {
      const { row: fromRow, col: fromCol } = selectedPositionRef.current;

      // 如果点击的是同一个位置，取消选择
      if (fromRow === row && fromCol === col) {
        selectedPositionRef.current = null;
        return;
      }

      // 如果点击的是己方其他棋子，切换选择
      if (clickedPiece && clickedPiece.side === currentSide) {
        selectedPositionRef.current = { row, col };
        return;
      }

      // 尝试移动
      const move: ChessMove = {
        fromRow,
        fromCol,
        toRow: row,
        toCol: col,
      };

      if (isLegalMove(board, move, currentSide)) {
        commitMove(board, move, currentSide, {
          reason: "玩家走子",
        });
        selectedPositionRef.current = null;
      }
      return;
    }

    // 如果点击的是己方棋子，选中它
    if (clickedPiece && clickedPiece.side === currentSide) {
      selectedPositionRef.current = { row, col };
    }
  }, [isSingle, isPvP, started, gameOver, currentSide, playerSide, board, commitMove]);

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
        <p className="sub">
          {isSingle
            ? `玩家 (${sideLabel(playerSide)}) vs AI，点击棋盘走子`
            : isPvP
            ? "双人对战，点击棋盘走子"
            : "白方先手，黑白双方均由 LLM 控制"}
        </p>

        <div className="modeSelector">
          <div className="modeToggleGroup">
            <button
              className={isAiVsAi ? "active" : ""}
              onClick={() => setGameMode("ai-vs-ai")}
              disabled={started}
              type="button"
            >
              双 AI 对战
            </button>
            <button
              className={isSingle ? "active" : ""}
              onClick={() => setGameMode("single")}
              disabled={started}
              type="button"
            >
              单人对 AI
            </button>
            <button
              className={isPvP ? "active" : ""}
              onClick={() => setGameMode("pvp")}
              disabled={started}
              type="button"
            >
              双人对战
            </button>
          </div>
          {isSingle && (
            <div className="sideSelector">
              <span>选择先手：</span>
              <button
                className={playerSide === WHITE_SIDE ? "active" : ""}
                onClick={() => setPlayerSide(WHITE_SIDE)}
                disabled={started}
                type="button"
              >
                白方 (玩家)
              </button>
              <button
                className={playerSide === BLACK_SIDE ? "active" : ""}
                onClick={() => setPlayerSide(BLACK_SIDE)}
                disabled={started}
                type="button"
              >
                黑方 (玩家)
              </button>
            </div>
          )}
        </div>

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
          {(isAiVsAi || isSingle) && (
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
          )}

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
          <button onClick={undoMove} disabled={!started || boardHistory.length === 0 || gameOver}>
            悔棋
          </button>
          <button onClick={restartGame}>重新开始</button>
          <button className="ghost" onClick={clearStats}>
            清空战绩
          </button>
        </div>

        <p className="status">{statusText}</p>
        {lastReason ? <p className="reason">上一步理由：{lastReason}</p> : null}
        {error ? (
          <div>
            <p className="error">{error}</p>
            {retryCount > 0 && <p className="error">已重试 {retryCount} 次</p>}
            <button onClick={retryAiMove} style={{ marginTop: '8px' }}>
              重试 AI 落子
            </button>
          </div>
        ) : null}

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
                  const isSelected =
                    selectedPositionRef.current?.row === rowIndex &&
                    selectedPositionRef.current?.col === colIndex;

                  const className = [
                    "chessCell",
                    dark ? "dark" : "light",
                    isLast ? "last" : "",
                    isSelected ? "selected" : "",
                  ]
                    .filter(Boolean)
                    .join(" ");

                  return (
                    <div
                      key={`cell-${rowIndex}-${colIndex}`}
                      className={className}
                      onClick={() => handleCellClick(rowIndex, colIndex)}
                      style={{ cursor: (isSingle || isPvP) && started && !gameOver ? "pointer" : "default" }}
                    >
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
