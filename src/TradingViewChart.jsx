import React, { useEffect, useRef, useState } from "react";

const TV_SCRIPT_ID = "tradingview-tv-js";
const TV_SCRIPT_SRC = "https://s3.tradingview.com/tv.js";
const TV_CONTAINER_ID = "tv-btc-advanced-chart";

const loadTradingViewScript = () =>
  new Promise((resolve, reject) => {
    if (window.TradingView) {
      resolve(window.TradingView);
      return;
    }

    const existing = document.getElementById(TV_SCRIPT_ID);

    if (existing) {
      existing.addEventListener("load", () => resolve(window.TradingView), { once: true });
      existing.addEventListener("error", () => reject(new Error("TradingView script failed")), {
        once: true,
      });
      return;
    }

    const script = document.createElement("script");
    script.id = TV_SCRIPT_ID;
    script.src = TV_SCRIPT_SRC;
    script.async = true;
    script.onload = () => resolve(window.TradingView);
    script.onerror = () => reject(new Error("TradingView script failed"));
    document.body.appendChild(script);
  });

const toTvInterval = (interval) => {
  if (interval === "15m") {
    return "15";
  }

  if (interval === "1h") {
    return "60";
  }

  if (interval === "1d") {
    return "D";
  }

  return "5";
};

const compactChartQuery = "(max-width: 960px)";

function TradingViewChart({ interval = "5m" }) {
  const containerRef = useRef(null);
  const widgetRef = useRef(null);
  const widgetModeRef = useRef(null);
  const tvInterval = toTvInterval(interval);
  const [compact, setCompact] = useState(() => window.matchMedia(compactChartQuery).matches);

  useEffect(() => {
    const media = window.matchMedia(compactChartQuery);
    const onChange = () => setCompact(media.matches);

    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    let cancelled = false;

    const mountWidget = async () => {
      try {
        const TradingView = await loadTradingViewScript();

        if (cancelled || !container || !TradingView) {
          return;
        }

        const existingWidget = widgetRef.current;

        if (
          existingWidget &&
          widgetModeRef.current === compact &&
          typeof existingWidget.chart === "function"
        ) {
          try {
            existingWidget.chart().setResolution(tvInterval);
            return;
          } catch (error) {
            // Recreate the widget if the embed API cannot change resolution.
          }
        }

        container.innerHTML = "";
        widgetModeRef.current = compact;
        widgetRef.current = new TradingView.widget({
          autosize: true,
          symbol: "BYBIT:BTCUSDT.P",
          interval: tvInterval,
          timezone: "America/New_York",
          theme: "dark",
          style: "1",
          locale: "en",
          toolbar_bg: "#111113",
          enable_publishing: false,
          hide_top_toolbar: false,
          hide_side_toolbar: false,
          allow_symbol_change: false,
          save_image: !compact,
          withdateranges: !compact,
          enabled_features: compact ? ["volume_force_overlay"] : [],
          disabled_features: compact
            ? [
                "timeframes_toolbar",
                "header_compare",
                "header_screenshot",
                "header_fullscreen_button",
                "header_saveload",
              ]
            : [],
          studies: [
            {
              id: "Volume@tv-basicstudies",
              inputs: {
                length: 20,
              },
            },
          ],
          studies_overrides: {
            "volume.show ma": true,
            "volume.ma length": 20,
            "volume.volume ma.color": "#38bdf8",
            "volume.volume ma.linewidth": 2,
            "volume.volume ma.transparency": 0,
          },
          overrides: compact
            ? {
                volumePaneSize: "small",
              }
            : undefined,
          container_id: TV_CONTAINER_ID,
        });
      } catch (error) {
        // Keep the empty chart container if TradingView fails to load.
      }
    };

    mountWidget();

    return () => {
      cancelled = true;
    };
  }, [tvInterval, compact]);

  useEffect(
    () => () => {
      widgetRef.current = null;
      if (containerRef.current) {
        containerRef.current.innerHTML = "";
      }
    },
    [],
  );

  return <div id={TV_CONTAINER_ID} ref={containerRef} className="tv-chart" />;
}

export default TradingViewChart;
