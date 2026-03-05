"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { SideConfigPanel } from "../components/gomoku/SideConfigPanel";
import { drawBoard, CANVAS_SIZE, PADDING, CELL, BOARD_SIZE, type BoardMove } from "../lib/boardCanvas";
import {
  applyMove,
  BLACK,
  boardToCompactText,
  checkWin,
  createBoard,
  generateCandidateMoves,
  isBoardFull,
  isLegalMove,
  opponent,
  playerLabel,
  WHITE,
  type Board,
  type Player,
} from "../lib/game";
import { pickFallbackMove } from "../lib/gomoku/fallback";
import { requestLLMCompletion } from "../lib/gomoku/llm-client";
import { parseMoveFromLLMText } from "../lib/gomoku/move-parser";
import { buildMovePrompt } from "../lib/gomoku/prompt";
import { createInitialConversations, sideFromPlayer } from "../lib/gomoku/conversation";
import {
  type AIConversations,
  type EffectiveConfig,
  type EffectiveSideConfig,
  type LLMProxyPayload,
  type MoveCommitMeta,
  type MoveHistoryItem,
  type SideConfigInput,
} from "../lib/gomoku/types";
import {
  useSharedSideLLMConfig,
} from "../lib/hooks/use-shared-side-llm-config";

const AI_CONFIG_STORAGE_KEYS = {
  black: "gomoku:ai:black",
  white: "gomoku:ai:white",
} as const;

type GameModeType = "ai-vs-ai" | "single" | "pvp";

export default function GomokuClient() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [board, setBoard] = useState<Board>(() => createBoard());
  const [currentPlayer, setCurrentPlayer] = useState<Player>(BLACK);
  const [gameOver, setGameOver] = useState<boolean>(false);
  const [winner, setWinner] = useState<Player | 0 | null>(null);
  const [lastMove, setLastMove] = useState<BoardMove | null>(null);
  const [lastReason, setLastReason] = useState<string>("");
  const [thinking, setThinking] = useState<boolean>(false);
  const [started, setStarted] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  // 游戏模式：ai-vs-ai（双 AI）、single（单人对 AI）、pvp（双人对战）
  const [gameMode, setGameMode] = useState<GameModeType>("ai-vs-ai");
  const [playerSide, setPlayerSide] = useState<Player>(BLACK);
  const [boardHistory, setBoardHistory] = useState<Board[]>([]);

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

  const [speedMs, setSpeedMs] = useState<number>(250);
  const [stats, setStats] = useState({ black: 0, white: 0, draw: 0 });
  const [moveHistory, setMoveHistory] = useState<MoveHistoryItem[]>([]);
  const [aiConversations, setAiConversations] = useState<AIConversations>(() =>
    createInitialConversations(),
  );

  const effectiveConfig = useMemo<EffectiveConfig>(() => {
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
      black: build(blackAI),
      white: build(whiteAI),
    };
  }, [blackAI, whiteAI]);

  const activeModel = currentPlayer === BLACK ? effectiveConfig.black.model : effectiveConfig.white.model;
  const currentSideReady = currentPlayer === BLACK ? effectiveConfig.black.ready : effectiveConfig.white.ready;

  const blackThoughts = useMemo(
    () =>
      moveHistory
        .filter((item) => item.player === BLACK && item.thinking)
        .slice(-12)
        .reverse(),
    [moveHistory],
  );

  const whiteThoughts = useMemo(
    () =>
      moveHistory
        .filter((item) => item.player === WHITE && item.thinking)
        .slice(-12)
        .reverse(),
    [moveHistory],
  );

  const restartGame = useCallback(() => {
    setBoard(createBoard());
    setCurrentPlayer(BLACK);
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
  }, []);

  const clearStats = useCallback(() => {
    setStats({ black: 0, white: 0, draw: 0 });
  }, []);

  const commitMove = useCallback(
    (baseBoard: Board, row: number, col: number, player: Player, meta: MoveCommitMeta = {}): boolean => {
      const nextBoard = applyMove(baseBoard, row, col, player);
      if (!nextBoard) {
        return false;
      }

      // 保存当前棋盘到历史记录
      setBoardHistory((prev) => [...prev, baseBoard]);

      const moveReason = meta.reason || "";

      setBoard(nextBoard);
      setLastMove({ row, col, player });
      setLastReason(moveReason);

      setMoveHistory((prev) => [
        ...prev,
        {
          turn: prev.length + 1,
          player,
          row,
          col,
          reason: moveReason,
          thinking: meta.thinking || "",
          model: meta.model || "",
        },
      ]);

      if (checkWin(nextBoard, row, col, player)) {
        setGameOver(true);
        setWinner(player);
        setStats((prevStats) => {
          if (player === BLACK) {
            return { ...prevStats, black: prevStats.black + 1 };
          }
          return { ...prevStats, white: prevStats.white + 1 };
        });
        return true;
      }

      if (isBoardFull(nextBoard)) {
        setGameOver(true);
        setWinner(0);
        setStats((prevStats) => ({ ...prevStats, draw: prevStats.draw + 1 }));
        return true;
      }

      setCurrentPlayer(opponent(player));
      return true;
    },
    [],
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
    const lastPlayer = newMoveHistory.length > 0 ? newMoveHistory[newMoveHistory.length - 1].player : BLACK;
    setCurrentPlayer(opponent(lastPlayer));

    // 恢复最后一步信息
    if (newMoveHistory.length > 0) {
      const last = newMoveHistory[newMoveHistory.length - 1];
      setLastMove({ row: last.row, col: last.col, player: last.player });
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
  }, [boardHistory, gameOver, moveHistory, isSingle, started]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    drawBoard(context, board, lastMove);

    // 单人模式或 PvP 模式下添加点击事件
    if ((!isSingle && !isPvP) || !started || gameOver) {
      return;
    }

    const handleClick = (event: MouseEvent) => {
      // 只在玩家的回合响应点击
      if (isSingle && currentPlayer !== playerSide) {
        return;
      }

      const rect = canvas.getBoundingClientRect();
      const scaleX = CANVAS_SIZE / rect.width;
      const scaleY = CANVAS_SIZE / rect.height;

      const x = (event.clientX - rect.left) * scaleX;
      const y = (event.clientY - rect.top) * scaleY;

      const col = Math.round((x - PADDING) / CELL);
      const row = Math.round((y - PADDING) / CELL);

      if (row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE) {
        return;
      }

      if (!isLegalMove(board, row, col)) {
        return;
      }

      // 玩家落子（单人模式或 PvP）
      commitMove(board, row, col, currentPlayer, {
        reason: isSingle && currentPlayer === playerSide ? "玩家落子" : "玩家落子",
      });
    };

    canvas.addEventListener("click", handleClick);
    return () => {
      canvas.removeEventListener("click", handleClick);
    };
  }, [board, lastMove, isSingle, isPvP, started, gameOver, currentPlayer, playerSide, commitMove]);

  useEffect(() => {
    if (gameOver || !started) {
      return;
    }

    // 单人模式：如果是玩家的回合，跳过 AI 逻辑
    // PvP 模式：不需要 AI 逻辑
    if ((isSingle && currentPlayer === playerSide) || isPvP) {
      return;
    }

    if (!currentSideReady) {
      setError(`${playerLabel(currentPlayer)}未配置完整的 API URL / Model / API Key`);
      setThinking(false);
      return;
    }

    const player = currentPlayer;
    const currentBoard = board;
    const currentHistory = moveHistory;
    const sideInput = player === BLACK ? blackAI : whiteAI;
    const side = sideFromPlayer(player);
    const currentConversation = aiConversations[side];
    const controller = new AbortController();

    const timerId = setTimeout(async () => {
      const candidates = generateCandidateMoves(currentBoard, player, 14);
      const fallback = pickFallbackMove(currentBoard, candidates);

      setThinking(true);
      setError("");

      try {
        const prompt = buildMovePrompt({
          board: currentBoard,
          player,
          moveHistory: currentHistory,
          candidateMoves: candidates,
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
        const parsed = parseMoveFromLLMText(data.text);
        const assistantMessage = { role: "assistant" as const, content: data.text };

        setAiConversations((prev) => ({
          ...prev,
          [side]: [...prev[side], turnUserMessage, assistantMessage],
        }));

        let selected = parsed;
        if (!selected || !isLegalMove(currentBoard, selected.row, selected.col)) {
          if (!fallback) {
            throw new Error("没有可用落子点");
          }

          selected = {
            row: fallback.row,
            col: fallback.col,
            reason: "LLM输出无效，使用前端保底候选",
            thinking: parsed?.thinking || "",
          };

          setError("LLM输出非法，已使用前端保底候选点");
        }

        commitMove(currentBoard, selected.row, selected.col, player, {
          reason: selected.reason || "LLM落子",
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
      clearTimeout(timerId);
      controller.abort();
    };
  }, [
    blackAI,
    aiConversations,
    board,
    commitMove,
    currentPlayer,
    currentSideReady,
    gameOver,
    started,
    moveHistory,
    speedMs,
    whiteAI,
    isSingle,
    playerSide,
    isPvP,
  ]);

  const statusText = useMemo(() => {
    if (gameOver) {
      if (winner === 0) {
        return "平局";
      }
      return `${playerLabel(winner as Player)}获胜`;
    }

    if (!started) {
      if (isSingle || isPvP) {
        return "请选择模式并点击开始对战";
      }
      if (!effectiveConfig.black.ready || !effectiveConfig.white.ready) {
        return "请先配置黑白双方 API URL / Model / API Key，然后点击开始对战";
      }
      return "已就绪，点击「开始对战」";
    }

    // 单人模式
    if (isSingle) {
      if (currentPlayer === playerSide) {
        return "轮到你了，点击棋盘落子";
      }
      if (thinking) {
        return `AI（${activeModel}）思考中...`;
      }
      return `AI（${activeModel}）等待落子`;
    }

    // PvP 模式
    if (isPvP) {
      return `轮到${playerLabel(currentPlayer)}，点击棋盘落子`;
    }

    // 双 AI 模式
    if (thinking) {
      return `${playerLabel(currentPlayer)}（${activeModel}）思考中...`;
    }

    if (!currentSideReady) {
      return `${playerLabel(currentPlayer)}未配置完整参数`;
    }

    return `${playerLabel(currentPlayer)}（${activeModel}）等待落子`;
  }, [activeModel, currentPlayer, currentSideReady, effectiveConfig.black.ready, effectiveConfig.white.ready, gameOver, isSingle, isPvP, started, thinking, winner, playerSide]);

  const boardSummary = useMemo(() => boardToCompactText(board), [board]);

  return (
    <main className="app">
      <SideConfigPanel
        sideName="黑方"
        config={blackAI}
        effective={effectiveConfig.black}
        thoughts={blackThoughts}
        isThinking={started && !gameOver && currentPlayer === BLACK && thinking}
        onChange={(patch) => setBlackAI((prev) => ({ ...prev, ...patch }))}
      />

      <section className="centerPanel">
        <h1>五子棋 · 双 LLM 对战</h1>
        <p className="sub">
          {isSingle
            ? `玩家 (${playerLabel(playerSide)}) vs AI，点击棋盘落子`
            : isPvP
            ? "双人对战，点击棋盘落子"
            : "黑白双方均由 LLM 控制"}
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
                className={playerSide === BLACK ? "active" : ""}
                onClick={() => setPlayerSide(BLACK)}
                disabled={started}
                type="button"
              >
                黑子 (玩家)
              </button>
              <button
                className={playerSide === WHITE ? "active" : ""}
                onClick={() => setPlayerSide(WHITE)}
                disabled={started}
                type="button"
              >
                白子 (玩家)
              </button>
            </div>
          )}
        </div>

        <div className="centerControls">
          {(isAiVsAi || isSingle) && (
            <label>
              每步间隔（毫秒）
              <input
                type="range"
                min="120"
                max="1500"
                step="20"
                value={speedMs}
                onChange={(event) => setSpeedMs(Number(event.target.value))}
              />
              <span>{speedMs}</span>
            </label>
          )}
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
        {error ? <p className="error">{error}</p> : null}

        <div className="boardWrap">
          <canvas
            ref={canvasRef}
            width={CANVAS_SIZE}
            height={CANVAS_SIZE}
            className="board"
            aria-label="五子棋棋盘"
          />
        </div>

        <div className="stats">
          <div>
            <span>黑胜</span>
            <strong>{stats.black}</strong>
          </div>
          <div>
            <span>白胜</span>
            <strong>{stats.white}</strong>
          </div>
          <div>
            <span>平局</span>
            <strong>{stats.draw}</strong>
          </div>
        </div>

        <details className="summary">
          <summary>当前棋局摘要（发送给 LLM）</summary>
          <p>黑子：{boardSummary.black || "无"}</p>
          <p>白子：{boardSummary.white || "无"}</p>
          <p>总手数：{moveHistory.length}</p>
        </details>
      </section>

      <SideConfigPanel
        sideName="白方"
        config={whiteAI}
        effective={effectiveConfig.white}
        thoughts={whiteThoughts}
        isThinking={started && !gameOver && currentPlayer === WHITE && thinking}
        onChange={(patch) => setWhiteAI((prev) => ({ ...prev, ...patch }))}
      />
    </main>
  );
}
