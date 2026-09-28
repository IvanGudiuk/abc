import React, { useEffect, useMemo, useRef, useState } from "react";
import TradingViewChart from "./TradingViewChart";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
const WS_BASE_URL = (import.meta.env.VITE_WS_BASE_URL || "").replace(/\/$/, "");
const LOGIN_EMAIL = "pr-zt@ukr.net";
const AUTH_TOKEN_STORAGE_KEY = "polymarket_web_token";

const QUICK_AMOUNTS = [1, 3, 5, 10, 20, 50, 100];
const SELL_PERCENTS = [
  { label: "25%", value: 0.25 },
  { label: "50%", value: 0.5 },
  { label: "75%", value: 0.75 },
  { label: "Max", value: 1 },
];

const formatMoney = (value) => `$${Number(value || 0).toFixed(2)}`;
const formatUsd = (value) => {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return "—";
  }

  return `$${numericValue.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};
const formatUsdDelta = (value) => {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return "—";
  }

  const abs = Math.abs(numericValue).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  if (numericValue > 0) {
    return `+$${abs}`;
  }

  if (numericValue < 0) {
    return `-$${abs}`;
  }

  return "$0.00";
};
const formatCents = (value) => `${Math.round(Number(value || 0) * 100)}¢`;
const LIVE_QUOTE_FIELDS = ["upBuy", "upSell", "downBuy", "downSell"];

const sameDisplayedQuote = (left, right, field) =>
  Math.round(Number(left?.[field] || 0) * 100) === Math.round(Number(right?.[field] || 0) * 100);

const withStreamQuotes = (window, incoming, streamPrices) => {
  const next = { ...window, ...incoming };
  const streamed = streamPrices.get(next.slug);

  if (!streamed) {
    return next;
  }

  for (const field of LIVE_QUOTE_FIELDS) {
    const value = Number(streamed[field]);

    if (Number.isFinite(value) && value > 0) {
      next[field] = value;
    }
  }

  return next;
};
const formatShares = (value) => Number(value || 0).toFixed(4);
const formatShareCount = (value) => {
  const numericValue = Number(value || 0);

  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return "0";
  }

  return numericValue.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });
};
const formatReturnPercent = (value) => {
  const numericValue = Number(value || 0);

  if (!Number.isFinite(numericValue)) {
    return "0.00%";
  }

  const abs = Math.abs(numericValue).toFixed(2);
  if (numericValue > 0) {
    return `+${abs}%`;
  }
  if (numericValue < 0) {
    return `-${abs}%`;
  }
  return "0.00%";
};

const positionMatchesWindow = (position, windowItem) => {
  if (!position || !windowItem) {
    return false;
  }

  if (
    position.asset &&
    (position.asset === windowItem.upTokenId || position.asset === windowItem.downTokenId)
  ) {
    return true;
  }

  if (position.slug && position.slug === windowItem.slug) {
    return true;
  }

  if (position.eventSlug && position.eventSlug === windowItem.slug) {
    return true;
  }

  return false;
};

const getWindowStartMsFromPosition = (position = {}) => {
  const slug = String(position.slug || position.eventSlug || "");
  const match = slug.match(/-(\d{9,10})$/);
  return match ? Number(match[1]) * 1000 : null;
};

const getPositionStats = (position = {}) => {
  const size = Number(position.size || 0);
  const avgPrice = Number(position.avgPrice || 0);
  const cost = Number(position.initialValue || 0) || size * avgPrice;
  const value = Number(position.currentValue || 0);
  const pnl = Number(position.cashPnl || 0) || value - cost;
  const percent = cost > 0 ? (pnl / cost) * 100 : Number(position.percentPnl || 0);

  return { size, avgPrice, cost, value, pnl, percent };
};

const getStoredAuthToken = () => {
  if (typeof window === "undefined") {
    return "";
  }

  return window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY) || "";
};

const setStoredAuthToken = (value) => {
  if (typeof window === "undefined") {
    return;
  }

  if (value) {
    window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, value);
    return;
  }

  window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
};

const getWebSocketUrl = (authToken) => {
  const normalizedToken = String(authToken || "").trim();
  const baseUrl = WS_BASE_URL || (API_BASE_URL ? API_BASE_URL.replace(/^http/i, "ws") : "");

  if (baseUrl) {
    const separator = baseUrl.includes("?") ? "&" : "?";
    return `${baseUrl}/ws/prices${normalizedToken ? `${separator}token=${encodeURIComponent(normalizedToken)}` : ""}`;
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const query = normalizedToken ? `?token=${encodeURIComponent(normalizedToken)}` : "";
  return `${protocol}//${window.location.host}/ws/prices${query}`;
};

const formatCountdown = (endsAt, nowMs) => {
  const remainingMs = Math.max(0, Number(endsAt || 0) - nowMs);
  const totalSeconds = Math.floor(remainingMs / 1000);
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
};

async function apiFetch(path, options = {}) {
  const { headers: optionHeaders, ...restOptions } = options;
  const authToken = getStoredAuthToken();
  const response = await fetch(`${API_BASE_URL}${path}`, {
    cache: "no-store",
    credentials: "include",
    ...restOptions,
    headers: {
      "Content-Type": "application/json",
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...(optionHeaders || {}),
    },
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.message || "Request failed");
  }

  return payload;
}

function App() {
  const [authChecked, setAuthChecked] = useState(false);
  const [authenticated, setAuthenticated] = useState(Boolean(getStoredAuthToken()));
  const [authToken, setAuthToken] = useState(getStoredAuthToken());
  const [codeRequested, setCodeRequested] = useState(false);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [tradeNotice, setTradeNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [accounts, setAccounts] = useState([]);
  const [windows, setWindows] = useState([]);
  const [selectedInterval, setSelectedInterval] = useState("5m");
  const [selectedWindowStartMs, setSelectedWindowStartMs] = useState(null);
  const [tradeSide, setTradeSide] = useState("buy");
  const [outcome, setOutcome] = useState("up");
  const [orderType, setOrderType] = useState("market");
  const [amountUsd, setAmountUsd] = useState("");
  const [sellShares, setSellShares] = useState("");
  const [limitPrice, setLimitPrice] = useState("");
  const [nowMs, setNowMs] = useState(Date.now());
  const [orderTypeOpen, setOrderTypeOpen] = useState(false);
  const [btcPrices, setBtcPrices] = useState({
    currentPrice: 0,
    priceToBeat: 0,
  });
  const streamRef = useRef(null);
  const streamPricesRef = useRef(new Map());
  const orderTypeRef = useRef(null);
  const windowsLoadingRef = useRef(false);
  const tradeNoticeTimerRef = useRef(null);

  const showTradeNotice = (text, tone) => {
    if (tradeNoticeTimerRef.current) {
      window.clearTimeout(tradeNoticeTimerRef.current);
    }

    setTradeNotice({ text, tone });
    tradeNoticeTimerRef.current = window.setTimeout(() => {
      setTradeNotice(null);
      tradeNoticeTimerRef.current = null;
    }, 5000);
  };

  useEffect(
    () => () => {
      if (tradeNoticeTimerRef.current) {
        window.clearTimeout(tradeNoticeTimerRef.current);
      }
    },
    [],
  );

  const selectedAccount = useMemo(
    () => (accounts || []).find((account) => account.interval === selectedInterval),
    [accounts, selectedInterval],
  );
  const selectedWindow = useMemo(
    () =>
      windows.find((window) => window.windowStartMs === selectedWindowStartMs) || windows[0] || null,
    [windows, selectedWindowStartMs],
  );
  const intervalLabel = selectedInterval === "15m" ? "15m" : "5m";
  const intervalTabLabel = selectedInterval === "15m" ? "15 minute" : "5 minute";
  const intervalMs = selectedInterval === "15m" ? 15 * 60 * 1000 : 5 * 60 * 1000;
  const currentWindowStartMs = Math.floor(nowMs / intervalMs) * intervalMs;
  const isCurrentWindow = (windowItem) =>
    Number(windowItem?.windowStartMs) === currentWindowStartMs;
  const accountPositions = (selectedAccount?.positions || []).filter((position) => {
    const slug = String(position.slug || position.eventSlug || "");

    if (!slug.includes("-updown-")) {
      return true;
    }

    return selectedInterval === "15m" ? slug.includes("-15m-") : slug.includes("-5m-");
  });
  const windowPositions = accountPositions.filter((position) =>
    positionMatchesWindow(position, selectedWindow),
  );
  const upPosition = windowPositions.find(
    (position) =>
      position.outcome === "up" || position.asset === selectedWindow?.upTokenId,
  );
  const downPosition = windowPositions.find(
    (position) =>
      position.outcome === "down" || position.asset === selectedWindow?.downTokenId,
  );
  const selectedPosition = outcome === "down" ? downPosition : upPosition;
  const selectedPositionSize = Number(selectedPosition?.size || 0);

  const loadAccounts = async () => {
    const payload = await apiFetch("/api/dashboard");
    setAccounts(payload.accounts || []);
  };

  const loadWindows = async (interval = selectedInterval) => {
    if (windowsLoadingRef.current) {
      return;
    }

    windowsLoadingRef.current = true;

    try {
      const payload = await apiFetch(`/api/markets/windows?interval=${interval}&count=6`);
      const nextWindows = payload.windows || [];
      const nextIntervalMs = interval === "15m" ? 15 * 60 * 1000 : 5 * 60 * 1000;
      const liveStartMs = Math.floor(Date.now() / nextIntervalMs) * nextIntervalMs;
      setWindows(
        nextWindows.map((window) => withStreamQuotes(window, window, streamPricesRef.current)),
      );
      setSelectedWindowStartMs((current) => {
        const liveWindow = nextWindows.find((window) => window.windowStartMs === liveStartMs);
        const selectedExpired = current != null && current < liveStartMs;

        if (selectedExpired && liveWindow) {
          return liveWindow.windowStartMs;
        }

        const stillExists = nextWindows.some((window) => window.windowStartMs === current);

        if (stillExists) {
          return current;
        }

        return liveWindow?.windowStartMs || nextWindows[0]?.windowStartMs || null;
      });
    } finally {
      windowsLoadingRef.current = false;
    }
  };

  const refreshSelectedWindow = async () => {
    if (!selectedWindowStartMs) {
      return;
    }

    const payload = await apiFetch(
      `/api/markets/window?interval=${selectedInterval}&windowStartMs=${selectedWindowStartMs}`,
    );

    if (!payload.window) {
      return;
    }

    setWindows((current) =>
      current.map((window) =>
        window.windowStartMs === payload.window.windowStartMs
          ? withStreamQuotes(window, payload.window, streamPricesRef.current)
          : window,
      ),
    );
  };

  useEffect(() => {
    document.title = authenticated ? "Polymarket Trader" : "Sign in";
  }, [authenticated]);

  useEffect(() => {
    const bootstrap = async () => {
      try {
        await apiFetch("/api/auth/me");
        setAuthenticated(true);
        setAuthChecked(true);
        loadAccounts().catch(() => {});
        loadWindows(selectedInterval).catch((error) => {
          setMessage(error.message);
        });
        return;
      } catch (error) {
        setAuthToken("");
        setStoredAuthToken("");
        setAuthenticated(false);
      } finally {
        setAuthChecked(true);
      }
    };

    bootstrap();
  }, []);

  useEffect(() => {
    if (!authenticated) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => window.clearInterval(timer);
  }, [authenticated]);

  useEffect(() => {
    if (!authenticated || windows.length === 0) {
      return;
    }

    const liveWindow = windows.find(
      (windowItem) => windowItem.windowStartMs === currentWindowStartMs,
    );

    if (!liveWindow) {
      loadWindows(selectedInterval).catch((error) => {
        setMessage(error.message);
      });
      return;
    }

    if (
      selectedWindowStartMs != null &&
      selectedWindowStartMs < currentWindowStartMs
    ) {
      setSelectedWindowStartMs(liveWindow.windowStartMs);
    }
  }, [authenticated, windows, currentWindowStartMs, selectedInterval, selectedWindowStartMs]);

  useEffect(() => {
    if (!authenticated) {
      return undefined;
    }

    loadWindows(selectedInterval).catch((error) => {
      setMessage(error.message);
    });
  }, [authenticated, selectedInterval]);

  useEffect(() => {
    if (!authenticated || !selectedWindowStartMs) {
      return undefined;
    }

    refreshSelectedWindow().catch(() => {});
    const intervalId = window.setInterval(() => {
      refreshSelectedWindow().catch(() => {});
    }, 2000);

    return () => window.clearInterval(intervalId);
  }, [authenticated, selectedInterval, selectedWindowStartMs]);

  useEffect(() => {
    if (!authenticated) {
      return undefined;
    }

    loadAccounts().catch(() => {});
    const intervalId = window.setInterval(() => {
      loadAccounts().catch(() => {});
    }, 8000);

    return () => window.clearInterval(intervalId);
  }, [authenticated]);

  useEffect(() => {
    if (tradeSide !== "sell") {
      return;
    }

    setSellShares(selectedPositionSize > 0 ? formatShareCount(selectedPositionSize) : "");
  }, [tradeSide, outcome, selectedWindowStartMs, selectedPositionSize]);

  useEffect(() => {
    if (!authenticated) {
      return undefined;
    }

    const pullBtcPrices = async () => {
      try {
        const params = new URLSearchParams({ interval: selectedInterval });

        if (selectedWindowStartMs) {
          params.set("windowStartMs", String(selectedWindowStartMs));
        }

        const payload = await apiFetch(`/api/btc/prices?${params}`);
        setBtcPrices({
          currentPrice: Number(payload.currentPrice || 0),
          priceToBeat: Number(payload.priceToBeat || 0),
        });
      } catch (error) {
        // Keep the last known BTC prices if the request fails.
      }
    };

    pullBtcPrices();
    const intervalId = window.setInterval(pullBtcPrices, 2000);

    return () => window.clearInterval(intervalId);
  }, [authenticated, selectedInterval, selectedWindowStartMs]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (orderTypeRef.current && !orderTypeRef.current.contains(event.target)) {
        setOrderTypeOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (!authenticated) {
      if (streamRef.current) {
        streamRef.current.close();
        streamRef.current = null;
      }
      return undefined;
    }

    let reconnectTimeoutId = null;
    let cancelled = false;

    const connect = () => {
      const socket = new WebSocket(getWebSocketUrl(authToken));
      streamRef.current = socket;

      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data || "{}");
          const liveMarkets = payload.markets || [];

          setWindows((current) =>
            current.map((window) => {
              const live = liveMarkets.find((market) => market.slug === window.slug);

              if (!live) {
                return window;
              }

              const quotes = {
                upBuy: Number(live.upBuy || 0),
                upSell: Number(live.upSell || 0),
                downBuy: Number(live.downBuy || 0),
                downSell: Number(live.downSell || 0),
              };
              streamPricesRef.current.set(window.slug, quotes);

              if (LIVE_QUOTE_FIELDS.every((field) => sameDisplayedQuote(window, quotes, field))) {
                return window;
              }

              return {
                ...window,
                ...quotes,
              };
            }),
          );
        } catch (error) {
          // Ignore malformed payloads.
        }
      };

      socket.onclose = () => {
        if (streamRef.current === socket) {
          streamRef.current = null;
        }

        if (!cancelled) {
          reconnectTimeoutId = window.setTimeout(connect, 2000);
        }
      };

      socket.onerror = () => {
        socket.close();
      };
    };

    connect();

    return () => {
      cancelled = true;

      if (reconnectTimeoutId) {
        window.clearTimeout(reconnectTimeoutId);
      }

      streamRef.current?.close();
      streamRef.current = null;
    };
  }, [authenticated, authToken]);

  const handleRequestCode = async () => {
    setBusy(true);
    setMessage("");

    try {
      const payload = await apiFetch("/api/auth/request-code", {
        method: "POST",
        body: JSON.stringify({ email: LOGIN_EMAIL }),
      });
      setCodeRequested(true);
      setMessage(payload.message || "Code sent");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  };

  const handleVerifyCode = async () => {
    setBusy(true);
    setMessage("");

    try {
      const payload = await apiFetch("/api/auth/verify-code", {
        method: "POST",
        body: JSON.stringify({ email: LOGIN_EMAIL, code }),
      });
      setAuthToken(payload.token || "");
      setStoredAuthToken(payload.token || "");
      setAuthenticated(true);
      setCode("");
      loadAccounts().catch(() => {});
      loadWindows(selectedInterval).catch((error) => {
        setMessage(error.message);
      });
      setMessage("Logged in");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  };

  const handleLogout = async () => {
    setBusy(true);

    try {
      await apiFetch("/api/auth/logout", {
        method: "POST",
      });
    } catch (error) {
      // Clear local session anyway.
    } finally {
      setAuthToken("");
      setStoredAuthToken("");
      setAuthenticated(false);
      setCodeRequested(false);
      setWindows([]);
      streamPricesRef.current.clear();
      setAccounts([]);
      setMessage("");
      setBusy(false);
    }
  };

  const handleSellPosition = (position) => {
    const matchingWindow = windows.find((windowItem) =>
      positionMatchesWindow(position, windowItem),
    );
    const windowStartMs =
      matchingWindow?.windowStartMs || getWindowStartMsFromPosition(position);

    if (windowStartMs) {
      setSelectedWindowStartMs(windowStartMs);
    }

    if (windowStartMs && !matchingWindow) {
      apiFetch(
        `/api/markets/window?interval=${selectedInterval}&windowStartMs=${windowStartMs}`,
      )
        .then((payload) => {
          if (!payload?.window) {
            return;
          }

          setWindows((current) => {
            if (
              current.some(
                (windowItem) => windowItem.windowStartMs === payload.window.windowStartMs,
              )
            ) {
              return current;
            }

            return [payload.window, ...current];
          });
        })
        .catch(() => {});
    }

    const nextOutcome = position.outcome === "down" ? "down" : "up";
    setOutcome(nextOutcome);
    setTradeSide("sell");
    setSellShares(formatShareCount(position.size));
  };

  const applySellPercent = (percent) => {
    if (selectedPositionSize <= 0) {
      return;
    }

    setSellShares(formatShareCount(selectedPositionSize * percent));
  };

  const handleTrade = async () => {
    if (!selectedWindow?.available) {
      showTradeNotice("This candle is not available yet", "error");
      return;
    }

    if (tradeSide === "sell") {
      if (!Number(sellShares) || Number(sellShares) <= 0) {
        showTradeNotice("Shares must be greater than 0", "error");
        return;
      }
    } else if (!Number(amountUsd) || Number(amountUsd) <= 0) {
      showTradeNotice("Amount must be greater than 0", "error");
      return;
    }

    if (tradeNoticeTimerRef.current) {
      window.clearTimeout(tradeNoticeTimerRef.current);
      tradeNoticeTimerRef.current = null;
    }

    setBusy(true);
    setTradeNotice(null);

    try {
      await apiFetch("/api/trade/buy", {
        method: "POST",
        body: JSON.stringify({
          interval: selectedInterval,
          windowStartMs: selectedWindow.windowStartMs,
          outcome,
          side: tradeSide,
          orderType,
          amountUsd: tradeSide === "sell" ? Number(sellShares) : Number(amountUsd),
          shares: tradeSide === "sell" ? Number(sellShares) : undefined,
          price: limitPrice ? Number(limitPrice) : undefined,
        }),
      });
      await loadAccounts();
      showTradeNotice(
        `${tradeSide === "sell" ? "Sell" : "Buy"} ${outcome.toUpperCase()} sent for ${selectedWindow.slotLabel}`,
        "success",
      );
    } catch (error) {
      showTradeNotice(error.message, "error");
    } finally {
      setBusy(false);
    }
  };

  const priceDelta =
    btcPrices.priceToBeat > 0 && btcPrices.currentPrice > 0
      ? btcPrices.currentPrice - btcPrices.priceToBeat
      : null;
  const currentPriceTone =
    priceDelta === null ? "" : priceDelta >= 0 ? "up" : "down";

  if (!authChecked) {
    return <div className="screen centered">Loading...</div>;
  }

  if (!authenticated) {
    return (
      <div className="screen centered">
        <div className="auth-card">
          <h1>Sign in</h1>
          <p>A 6-digit code will be sent to your email.</p>
          <button disabled={busy} onClick={handleRequestCode}>
            {busy ? "Sending..." : "Send code"}
          </button>
          {codeRequested ? (
            <>
              <label className="auth-field">
                6-digit code
                <input
                  className="auth-input"
                  value={code}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="000000"
                />
              </label>
              <button disabled={busy} onClick={handleVerifyCode}>
                {busy ? "Checking..." : "Login"}
              </button>
            </>
          ) : null}
          {message ? <div className="message">{message}</div> : null}
        </div>
      </div>
    );
  }

  const selectedPrice =
    outcome === "up"
      ? tradeSide === "sell"
        ? selectedWindow?.upSell
        : selectedWindow?.upBuy
      : tradeSide === "sell"
        ? selectedWindow?.downSell
        : selectedWindow?.downBuy;

  return (
    <div className="pm-app">
      <header className="pm-topbar">
        <div className="pm-topbar-left">
          <span className="logo-mark" />
          <strong>Polymarket</strong>
        </div>
        <div className="pm-topbar-right">
          <div className="pm-balance-chip">
            <span>Portfolio</span>
            <strong>{formatMoney(selectedAccount?.balance?.portfolioBalance)}</strong>
          </div>
          <div className="pm-balance-chip">
            <span>Cash</span>
            <strong>{formatMoney(selectedAccount?.balance?.cashBalance)}</strong>
          </div>
          <button className="ghost-button" onClick={loadAccounts} disabled={busy}>
            Refresh
          </button>
          <button className="ghost-button" onClick={handleLogout} disabled={busy}>
            Logout
          </button>
        </div>
      </header>

      {message ? <div className="message banner">{message}</div> : null}

      <div className="pm-layout">
        <section className="pm-main">
          <div className="pm-title-row">
            <div className="btc-icon">₿</div>
            <div>
              <h1>BTC Up or Down {intervalLabel}</h1>
              <p>{selectedWindow?.rangeLabel || "Loading market..."}</p>
            </div>
          </div>

          <div className="pm-stats">
            <div>
              <span>Price To Beat</span>
              <strong>{formatUsd(btcPrices.priceToBeat)}</strong>
            </div>
            <div>
              <span>Current Price</span>
              <strong className={currentPriceTone ? `price-${currentPriceTone}` : ""}>
                {formatUsd(btcPrices.currentPrice)}
              </strong>
            </div>
            <div>
              <span>Change</span>
              <strong className={currentPriceTone ? `price-${currentPriceTone}` : ""}>
                {priceDelta === null ? "—" : formatUsdDelta(priceDelta)}
              </strong>
            </div>
          </div>

          <div className="chart-stub">
            <TradingViewChart interval={selectedInterval} />
            <div className="chart-timer">
              <span>{formatCountdown(selectedWindow?.windowEndMs, nowMs)}</span>
            </div>
          </div>

          <div className="slot-tabs">
            {windows.map((window) => (
              <button
                key={window.windowStartMs}
                className={
                  window.windowStartMs === selectedWindow?.windowStartMs
                    ? "slot-tab active"
                    : "slot-tab"
                }
                onClick={() => setSelectedWindowStartMs(window.windowStartMs)}
              >
                <span className={isCurrentWindow(window) ? "dot current" : "dot"} />
                {window.slotLabel}
              </button>
            ))}
          </div>

          <div className="positions-panel">
            <div className="positions-header">
              <strong>Positions</strong>
              <span>View Net Positions</span>
            </div>
            {accountPositions.length === 0 ? (
              <div className="empty-state">No open positions.</div>
            ) : (
              <div className="positions-table">
                <div className="positions-table-head">
                  <span>Outcome</span>
                  <span>Qty</span>
                  <span>Avg</span>
                  <span>Value</span>
                  <span>Return</span>
                  <span />
                </div>
                {accountPositions.map((position) => {
                  const stats = getPositionStats(position);
                  const outcomeLabel = String(position.outcome || "").toUpperCase() || "—";
                  const returnTone = stats.pnl > 0 ? "up" : stats.pnl < 0 ? "down" : "";

                  return (
                    <div className="positions-table-row" key={position.asset || `${position.slug}-${outcomeLabel}`}>
                      <div className={`position-outcome ${position.outcome || ""}`}>
                        {outcomeLabel}
                      </div>
                      <div>{formatShareCount(stats.size)}</div>
                      <div>
                        <div>{formatCents(stats.avgPrice)}</div>
                        <div className="position-cost">Cost {formatMoney(stats.cost)}</div>
                      </div>
                      <div>{formatMoney(stats.value)}</div>
                      <div className={returnTone ? `price-${returnTone}` : ""}>
                        {formatUsdDelta(stats.pnl)} ({formatReturnPercent(stats.percent)})
                      </div>
                      <div className="position-actions">
                        <button
                          type="button"
                          className="position-sell"
                          onClick={() => handleSellPosition(position)}
                        >
                          Sell
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        <aside className="pm-sidebar">
          <div className="trade-card">
            <div className="trade-card-title">
              <div className="btc-icon small">₿</div>
              <div>
                <strong>BTC Up or Down {intervalLabel}</strong>
                <p>{selectedWindow?.isCurrent ? "Current candle" : selectedWindow?.slotLabel}</p>
              </div>
            </div>

            <div className="side-tabs">
              <button
                className={tradeSide === "buy" ? "side-tab active" : "side-tab"}
                onClick={() => setTradeSide("buy")}
              >
                Buy
              </button>
              <button
                className={tradeSide === "sell" ? "side-tab active" : "side-tab"}
                onClick={() => {
                  if (!upPosition && downPosition) {
                    setOutcome("down");
                  } else if (!downPosition && upPosition) {
                    setOutcome("up");
                  }
                  setTradeSide("sell");
                }}
              >
                Sell
              </button>
              <div className="custom-select" ref={orderTypeRef}>
                <button
                  type="button"
                  className="custom-select-button"
                  onClick={() => setOrderTypeOpen((current) => !current)}
                >
                  {orderType === "limit" ? "Limit" : "Market"}
                  <span className="custom-select-caret">▾</span>
                </button>
                {orderTypeOpen ? (
                  <div className="custom-select-menu">
                    <button
                      type="button"
                      className={orderType === "market" ? "active" : ""}
                      onClick={() => {
                        setOrderType("market");
                        setOrderTypeOpen(false);
                      }}
                    >
                      Market
                    </button>
                    <button
                      type="button"
                      className={orderType === "limit" ? "active" : ""}
                      onClick={() => {
                        setOrderType("limit");
                        setOrderTypeOpen(false);
                      }}
                    >
                      Limit
                    </button>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="outcome-grid">
              <div className="outcome-stack">
                <button
                  className={outcome === "up" ? "outcome-button up active" : "outcome-button up"}
                  onClick={() => setOutcome("up")}
                >
                  Up {formatCents(selectedWindow?.upBuy)}
                </button>
                <div className="outcome-shares up">
                  {tradeSide === "sell" && upPosition
                    ? `${formatShareCount(upPosition.size)} shares`
                    : ""}
                </div>
              </div>
              <div className="outcome-stack">
                <button
                  className={outcome === "down" ? "outcome-button down active" : "outcome-button down"}
                  onClick={() => setOutcome("down")}
                >
                  Down {formatCents(selectedWindow?.downBuy)}
                </button>
                <div className="outcome-shares down">
                  {tradeSide === "sell" && downPosition
                    ? `${formatShareCount(downPosition.size)} shares`
                    : ""}
                </div>
              </div>
            </div>

            {tradeSide === "sell" ? (
              <>
                <label className="amount-label">
                  Shares
                  <div className="amount-box shares-box">
                    <input
                      type="number"
                      min="0"
                      step="0.0001"
                      value={sellShares}
                      onChange={(event) => setSellShares(event.target.value)}
                      placeholder="0"
                    />
                  </div>
                </label>

                {orderType === "limit" ? (
                  <label className="amount-label">
                    Price
                    <input
                      type="number"
                      min="0"
                      max="1"
                      step="0.01"
                      value={limitPrice}
                      onChange={(event) => setLimitPrice(event.target.value)}
                    />
                  </label>
                ) : null}

                <div className="quick-amounts">
                  {SELL_PERCENTS.map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      className="amount-tab"
                      disabled={selectedPositionSize <= 0}
                      onClick={() => applySellPercent(item.value)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>

                <div className="receive-row">
                  <div>
                    <div className="receive-label">You&apos;ll receive</div>
                    {selectedPosition ? (
                      <div className="receive-avg">Avg. Price {formatCents(selectedPosition.avgPrice)}</div>
                    ) : null}
                  </div>
                  <strong>{formatMoney(Number(sellShares || 0) * Number(selectedPrice || 0))}</strong>
                </div>
              </>
            ) : (
              <>
                <label className="amount-label">
                  Amount
                  <div className="amount-box">
                    <span>$</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={amountUsd}
                      onChange={(event) => setAmountUsd(event.target.value)}
                      placeholder="0"
                    />
                  </div>
                </label>

                {orderType === "limit" ? (
                  <label className="amount-label">
                    Price
                    <input
                      type="number"
                      min="0"
                      max="1"
                      step="0.01"
                      value={limitPrice}
                      onChange={(event) => setLimitPrice(event.target.value)}
                    />
                  </label>
                ) : null}

                <div className="cash-row">
                  <span>{formatMoney(selectedAccount?.balance?.cashBalance)} cash</span>
                  <strong>{selectedPrice ? formatCents(selectedPrice) : "—"}</strong>
                </div>

                <div className="quick-amounts">
                  {QUICK_AMOUNTS.map((value) => (
                    <button
                      key={value}
                      type="button"
                      className={
                        Number(amountUsd) === value ? "amount-tab active" : "amount-tab"
                      }
                      onClick={() => setAmountUsd(String(value))}
                    >
                      ${value}
                    </button>
                  ))}
                </div>
              </>
            )}

            {tradeNotice ? (
              <div className={`trade-notice ${tradeNotice.tone}`} role="status">
                {tradeNotice.text}
              </div>
            ) : null}

            <button
              className="primary-trade"
              disabled={
                busy ||
                !selectedWindow?.available ||
                (tradeSide === "sell" && (!selectedPosition || Number(sellShares) <= 0))
              }
              onClick={handleTrade}
            >
              {busy
                ? "Sending..."
                : `${tradeSide === "sell" ? "Sell" : "Buy"} ${outcome.toUpperCase()}`}
            </button>

            {!selectedWindow?.available ? (
              <div className="empty-state">This future candle is not listed yet.</div>
            ) : null}

            <p className="terms">By trading, you agree to the Terms of Use.</p>
          </div>

          <div className="interval-tabs">
            <button
              className={selectedInterval === "5m" ? "interval-tab active" : "interval-tab"}
              onClick={() => setSelectedInterval("5m")}
            >
              5 minute
            </button>
            <button
              className={selectedInterval === "15m" ? "interval-tab active" : "interval-tab"}
              onClick={() => setSelectedInterval("15m")}
            >
              15 minute
            </button>
            <button className="interval-tab" disabled>
              1 hour
            </button>
            <button className="interval-tab" disabled>
              1 day
            </button>
          </div>
          <div className="interval-hint">Trading {intervalTabLabel} candles, including future slots.</div>
        </aside>
      </div>
    </div>
  );
}

export default App;
