"use client";

import { useEffect, useState } from "react";
import GomokuClient from "./GomokuClient";
import XiangqiClient from "./XiangqiClient";

type GameMode = "gomoku" | "xiangqi";

const STORAGE_KEY = "llm-battle:game-mode";
const GITHUB_URL = "https://github.com/murongg/ai-zhuqi-battle";

export default function GameHubClient() {
  const [mode, setMode] = useState<GameMode>("gomoku");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === "gomoku" || stored === "xiangqi") {
        setMode(stored);
      }
    } catch {
      // Ignore browser storage errors.
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!hydrated) {
      return;
    }
    try {
      window.localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // Ignore browser storage errors.
    }
  }, [hydrated, mode]);

  return (
    <>
      <header className="gameSwitcher">
        <div className="gameSwitcherTabs">
          <button
            className={mode === "gomoku" ? "active" : ""}
            onClick={() => setMode("gomoku")}
            type="button"
          >
            五子棋
          </button>
          <button
            className={mode === "xiangqi" ? "active" : ""}
            onClick={() => setMode("xiangqi")}
            type="button"
          >
            中国象棋
          </button>
        </div>

        <a
          className="githubLink"
          href={GITHUB_URL}
          target="_blank"
          rel="noreferrer"
          aria-label="GitHub"
          title="GitHub"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="currentColor"
              d="M12 .3A12 12 0 0 0 8.2 23.7c.6.1.8-.3.8-.6V21c-3.3.7-4-1.6-4-1.6-.6-1.4-1.3-1.8-1.3-1.8-1.1-.8.1-.8.1-.8 1.2.1 1.8 1.2 1.8 1.2 1.1 1.9 2.9 1.3 3.6 1 .1-.8.4-1.3.8-1.6-2.6-.3-5.4-1.3-5.4-5.9 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.6 1.6.2 2.8.1 3.1.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.4 5.9.4.3.8 1 .8 2.1v3.1c0 .3.2.7.8.6A12 12 0 0 0 12 .3Z"
            />
          </svg>
        </a>
      </header>

      {mode === "gomoku" ? <GomokuClient /> : <XiangqiClient />}
    </>
  );
}
