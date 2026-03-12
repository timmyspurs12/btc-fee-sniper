import { useState, useEffect, useRef, useCallback } from "react";

// ── Contract config (updated after deploy) ────────────────────────────────────
const CONTRACT_ADDRESS = "YOUR_CONTRACT_ADDRESS_HERE";
const NETWORK = "testnet"; // "mainnet" | "testnet"
const MEMPOOL_WS =
  NETWORK === "testnet"
    ? "wss://mempool.space/testnet/api/v1/ws"
    : "wss://mempool.space/api/v1/ws";

// ── Helpers ───────────────────────────────────────────────────────────────────
function feeColor(fee, target) {
  if (target <= 0) return "#94a3b8";
  if (fee <= target) return "#22d3a5";
  if (fee <= target * 1.5) return "#fbbf24";
  return "#f87171";
}

function Ring({ value, max, color, label, sub }) {
  const pct = Math.min(value / max, 1);
  const r = 38;
  const circ = 2 * Math.PI * r;
  const dash = circ * pct;

  return (
    <div style={{ textAlign: "center", flex: 1 }}>
      <svg width="96" height="96" viewBox="0 0 96 96">
        <circle cx="48" cy="48" r={r} fill="none" stroke="#1e293b" strokeWidth="8" />
        <circle
          cx="48" cy="48" r={r} fill="none"
          stroke={color} strokeWidth="8"
          strokeDasharray={`${dash} ${circ}`}
          strokeLinecap="round"
          transform="rotate(-90 48 48)"
          style={{ transition: "stroke-dasharray 0.6s ease, stroke 0.4s" }}
        />
        <text x="48" y="44" textAnchor="middle" fill="#f1f5f9" fontSize="13" fontWeight="700" fontFamily="'JetBrains Mono', monospace">
          {value}
        </text>
        <text x="48" y="58" textAnchor="middle" fill="#64748b" fontSize="8" fontFamily="'JetBrains Mono', monospace">
          sat/vB
        </text>
      </svg>
      <div style={{ color: "#94a3b8", fontSize: "11px", marginTop: "4px", fontFamily: "'JetBrains Mono', monospace" }}>{label}</div>
      <div style={{ color: "#475569", fontSize: "10px" }}>{sub}</div>
    </div>
  );
}

function Ticker({ fees, target }) {
  if (!fees) return null;
  const max = Math.max(fees.fastestFee, 80);
  return (
    <div style={{ display: "flex", gap: "8px", justifyContent: "center", margin: "32px 0" }}>
      <Ring value={fees.fastestFee} max={max} color={feeColor(fees.fastestFee, target)} label="Next Block" sub="~10 min" />
      <Ring value={fees.halfHourFee} max={max} color={feeColor(fees.halfHourFee, target)} label="Half Hour" sub="~30 min" />
      <Ring value={fees.hourFee} max={max} color={feeColor(fees.hourFee, target)} label="One Hour" sub="~60 min" />
      <Ring value={fees.economyFee} max={max} color={feeColor(fees.economyFee, target)} label="Economy" sub="~2-4 hr" />
    </div>
  );
}

function PulsingDot({ color }) {
  return (
    <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: color, boxShadow: `0 0 6px ${color}`, animation: "pulse 1.6s infinite" }} />
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function FeeSniper() {
  const [fees, setFees] = useState(null);
  const [wsLive, setWsLive] = useState(false);
  const [targetFee, setTargetFee] = useState("");
  const [txHex, setTxHex] = useState("");
  const [status, setStatus] = useState("idle");
  const [walletAddress, setWalletAddress] = useState(null);
  const [log, setLog] = useState([]);
  const [feeHistory, setFeeHistory] = useState([]);
  const wsRef = useRef(null);
  const alertedRef = useRef(false);

  const addLog = useCallback((msg) => {
    setLog((prev) => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev.slice(0, 49)]);
  }, []);

  // ── WebSocket ───────────────────────────────────────────────────────────────
  useEffect(() => {
    function connect() {
      const ws = new WebSocket(MEMPOOL_WS);
      wsRef.current = ws;

      ws.onopen = () => {
        setWsLive(true);
        ws.send(JSON.stringify({ action: "want", data: ["stats"] }));
        addLog("Connected to mempool.space live feed");
      };

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.fees) {
            const f = {
              fastestFee: msg.fees.fastestFee,
              halfHourFee: msg.fees.halfHourFee,
              hourFee: msg.fees.hourFee,
              economyFee: msg.fees.economyFee ?? msg.fees.hourFee,
              minimumFee: msg.fees.minimumFee ?? 1,
            };
            setFees(f);
            setFeeHistory((prev) => [...prev.slice(-59), f.hourFee]);
          }
        } catch (_) {}
      };

      ws.onclose = () => {
        setWsLive(false);
        setTimeout(connect, 5000);
      };

      ws.onerror = () => ws.close();
    }
    connect();
    return () => wsRef.current?.close();
  }, [addLog]);

  // ── Check target ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!fees || status !== "watching" || alertedRef.current) return;
    const t = parseFloat(targetFee);
    if (t > 0 && fees.hourFee <= t) {
      alertedRef.current = true;
      setStatus("window_open");
      addLog(`🚀 FEE WINDOW OPEN! 1h fee = ${fees.hourFee} sat/vB ≤ target ${t}`);
      try {
        const ctx = new AudioContext();
        [440, 554, 659].forEach((freq, i) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.frequency.value = freq;
          gain.gain.setValueAtTime(0.3, ctx.currentTime + i * 0.15);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.15 + 0.4);
          osc.start(ctx.currentTime + i * 0.15);
          osc.stop(ctx.currentTime + i * 0.15 + 0.4);
        });
      } catch (_) {}
    }
  }, [fees, status, targetFee, addLog]);

  // ── Connect OPWallet ─────────────────────────────────────────────────────────
  async function connectWallet() {
    const opw = window.opnet || window.OPWallet;
    if (!opw) {
      addLog("❌ OPWallet not found — install the extension first");
      return;
    }
    try {
      const accounts = await opw.requestAccounts();
      setWalletAddress(accounts[0]);
      addLog(`✅ Wallet connected: ${accounts[0].slice(0, 16)}...`);
    } catch (e) {
      addLog(`❌ Wallet connect failed: ${e.message}`);
    }
  }

  // ── Register on-chain ─────────────────────────────────────────────────────────
  async function registerOnChain() {
    const t = parseFloat(targetFee);
    if (!t || t <= 0) { addLog("❌ Set a valid target fee first"); return; }
    if (!txHex.trim()) { addLog("❌ Paste your raw transaction hex first"); return; }
    if (!walletAddress) { addLog("❌ Connect OPWallet first"); return; }

    const opw = window.opnet || window.OPWallet;
    try {
      addLog("Registering on OPNet contract...");
      const txid = await opw.sendTransaction({
        to: CONTRACT_ADDRESS,
        data: "0xf2a12b58",
        network: NETWORK,
      });
      addLog(`✅ Registered! TXID: ${txid}`);
      alertedRef.current = false;
      setStatus("watching");
      addLog(`👁 Watching mempool — target: ${t} sat/vB`);
    } catch (e) {
      addLog(`❌ Registration failed: ${e.message}`);
      setStatus("error");
    }
  }

  function startWatching() {
    const t = parseFloat(targetFee);
    if (!t || t <= 0) { addLog("❌ Enter a target fee (sat/vB)"); return; }
    alertedRef.current = false;
    setStatus("watching");
    addLog(`👁 Watching mempool — target: ${t} sat/vB (local mode)`);
  }

  function reset() {
    alertedRef.current = false;
    setStatus("idle");
    addLog("Reset. Set new parameters to watch again.");
  }

  const statusColors = {
    idle: "#475569",
    watching: "#3b82f6",
    window_open: "#22d3a5",
    broadcast: "#a78bfa",
    error: "#f87171",
  };

  const statusLabels = {
    idle: "Idle",
    watching: "Watching...",
    window_open: "🚀 Window Open!",
    broadcast: "Broadcasting",
    error: "Error",
  };

  const t = parseFloat(targetFee) || 0;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=Syne:wght@700;800&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #020817; }
        @keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.5;transform:scale(1.4)} }
        @keyframes slideIn { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
        @keyframes glow { 0%,100%{box-shadow:0 0 20px #22d3a540} 50%{box-shadow:0 0 40px #22d3a580} }
        .card { animation: slideIn 0.4s ease; }
        .win { animation: glow 2s infinite; }
        textarea, input { outline: none; }
        ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-track { background:#0f172a; } ::-webkit-scrollbar-thumb { background:#334155; border-radius:2px; }
      `}</style>

      <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #020817 0%, #0c1628 50%, #020817 100%)", fontFamily: "'JetBrains Mono', monospace", color: "#f1f5f9", padding: "24px 16px" }}>
        <div style={{ maxWidth: 860, margin: "0 auto" }}>

          {/* Header */}
          <div style={{ textAlign: "center", marginBottom: "40px" }}>
            <div style={{ fontSize: "11px", letterSpacing: "4px", color: "#f59e0b", textTransform: "uppercase", marginBottom: "12px" }}>Bitcoin · OPNet</div>
            <h1 style={{ fontFamily: "'Syne', sans-serif", fontSize: "clamp(28px,5vw,52px)", fontWeight: 800, background: "linear-gradient(135deg, #f1f5f9 30%, #22d3a5)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", letterSpacing: "-1px", lineHeight: 1.1 }}>
              Mempool Fee<br />Sniper
            </h1>
            <p style={{ color: "#64748b", fontSize: "13px", marginTop: "12px", maxWidth: "400px", margin: "12px auto 0" }}>
              Register your target fee on-chain. Get alerted the moment the window opens.
            </p>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", marginTop: "16px" }}>
              <PulsingDot color={wsLive ? "#22d3a5" : "#f87171"} />
              <span style={{ fontSize: "11px", color: wsLive ? "#22d3a5" : "#f87171" }}>
                {wsLive ? "Live mempool feed" : "Reconnecting..."}
              </span>
              <span style={{ color: "#334155", fontSize: "11px" }}>·</span>
              <span style={{ fontSize: "11px", color: statusColors[status] }}>
                {statusLabels[status]}
              </span>
            </div>
          </div>

          {/* Fee Rings */}
          <div className="card" style={{ background: "rgba(15,23,42,0.8)", border: "1px solid #1e293b", borderRadius: "16px", padding: "24px", marginBottom: "16px", backdropFilter: "blur(12px)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
              <span style={{ fontSize: "11px", color: "#475569", letterSpacing: "2px", textTransform: "uppercase" }}>Live Fee Estimates</span>
              {fees && <span style={{ fontSize: "10px", color: "#334155" }}>mempool.space</span>}
            </div>
            {fees ? <Ticker fees={fees} target={t} /> : (
              <div style={{ textAlign: "center", padding: "40px", color: "#334155", fontSize: "13px" }}>Connecting to mempool feed...</div>
            )}

            {/* Sparkline */}
            {feeHistory.length > 2 && (
              <div style={{ marginTop: "8px" }}>
                <svg width="100%" height="40" viewBox={`0 0 ${feeHistory.length} 40`} preserveAspectRatio="none">
                  <defs>
                    <linearGradient id="sg" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#22d3a5" stopOpacity="0.4" />
                      <stop offset="100%" stopColor="#22d3a5" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  {(() => {
                    const mn = Math.min(...feeHistory);
                    const mx = Math.max(...feeHistory, mn + 1);
                    const pts = feeHistory.map((v, i) => `${i},${40 - ((v - mn) / (mx - mn)) * 36}`).join(" ");
                    const area = `0,40 ${pts} ${feeHistory.length - 1},40`;
                    return <>
                      <polygon points={area} fill="url(#sg)" />
                      <polyline points={pts} fill="none" stroke="#22d3a5" strokeWidth="1.5" />
                    </>;
                  })()}
                </svg>
                <div style={{ fontSize: "10px", color: "#334155", textAlign: "center" }}>1h fee trend (last {feeHistory.length} readings)</div>
              </div>
            )}
          </div>

          {/* Controls */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "16px" }}>
            {/* Target Fee */}
            <div className="card" style={{ background: "rgba(15,23,42,0.8)", border: "1px solid #1e293b", borderRadius: "16px", padding: "20px", backdropFilter: "blur(12px)" }}>
              <label style={{ fontSize: "11px", color: "#475569", letterSpacing: "2px", textTransform: "uppercase", display: "block", marginBottom: "12px" }}>Target Fee</label>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", background: "#0f172a", border: `1px solid ${t > 0 ? "#22d3a540" : "#1e293b"}`, borderRadius: "8px", padding: "10px 14px" }}>
                <input
                  type="number"
                  value={targetFee}
                  onChange={e => setTargetFee(e.target.value)}
                  placeholder="5"
                  style={{ background: "none", border: "none", color: "#f1f5f9", fontSize: "22px", fontWeight: "700", fontFamily: "'JetBrains Mono', monospace", width: "100%" }}
                />
                <span style={{ color: "#475569", fontSize: "12px", whiteSpace: "nowrap" }}>sat/vB</span>
              </div>
              {fees && t > 0 && (
                <div style={{ marginTop: "10px", fontSize: "11px", color: fees.hourFee <= t ? "#22d3a5" : "#64748b" }}>
                  {fees.hourFee <= t ? "✓ Window open right now!" : `Waiting — 1h fee is ${fees.hourFee} sat/vB`}
                </div>
              )}
            </div>

            {/* Wallet */}
            <div className="card" style={{ background: "rgba(15,23,42,0.8)", border: "1px solid #1e293b", borderRadius: "16px", padding: "20px", backdropFilter: "blur(12px)" }}>
              <label style={{ fontSize: "11px", color: "#475569", letterSpacing: "2px", textTransform: "uppercase", display: "block", marginBottom: "12px" }}>OPWallet</label>
              {walletAddress ? (
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                    <PulsingDot color="#22d3a5" />
                    <span style={{ fontSize: "12px", color: "#22d3a5" }}>Connected</span>
                  </div>
                  <div style={{ fontSize: "11px", color: "#475569", wordBreak: "break-all" }}>{walletAddress}</div>
                </div>
              ) : (
                <button
                  onClick={connectWallet}
                  style={{ width: "100%", padding: "12px", background: "linear-gradient(135deg, #f59e0b, #ef4444)", border: "none", borderRadius: "8px", color: "#fff", fontWeight: "700", fontFamily: "'JetBrains Mono', monospace", fontSize: "13px", cursor: "pointer" }}
                >
                  Connect OPWallet
                </button>
              )}
              <div style={{ marginTop: "10px", fontSize: "10px", color: "#334155" }}>Required for on-chain registration</div>
            </div>
          </div>

          {/* TX Hex */}
          <div className="card" style={{ background: "rgba(15,23,42,0.8)", border: "1px solid #1e293b", borderRadius: "16px", padding: "20px", marginBottom: "16px", backdropFilter: "blur(12px)" }}>
            <label style={{ fontSize: "11px", color: "#475569", letterSpacing: "2px", textTransform: "uppercase", display: "block", marginBottom: "12px" }}>
              Pre-Signed Transaction Hex
              <span style={{ marginLeft: "8px", color: "#334155", textTransform: "none", letterSpacing: 0 }}>(optional)</span>
            </label>
            <textarea
              value={txHex}
              onChange={e => setTxHex(e.target.value)}
              placeholder="0100000001abc123... (your raw signed Bitcoin transaction hex)"
              rows={3}
              style={{ width: "100%", background: "#0f172a", border: "1px solid #1e293b", borderRadius: "8px", padding: "12px", color: "#94a3b8", fontSize: "11px", fontFamily: "'JetBrains Mono', monospace", resize: "vertical" }}
            />
          </div>

          {/* Buttons */}
          <div style={{ display: "flex", gap: "12px", marginBottom: "16px" }}>
            <button
              onClick={startWatching}
              disabled={status === "watching"}
              style={{ flex: 1, padding: "14px", background: status === "watching" ? "#1e293b" : "linear-gradient(135deg, #22d3a5, #0891b2)", border: "none", borderRadius: "10px", color: status === "watching" ? "#475569" : "#fff", fontWeight: "700", fontFamily: "'JetBrains Mono', monospace", fontSize: "13px", cursor: status === "watching" ? "default" : "pointer" }}
            >
              {status === "watching" ? "● Watching..." : "▶ Watch (Local)"}
            </button>
            <button
              onClick={registerOnChain}
              disabled={!walletAddress || status === "watching"}
              style={{ flex: 1, padding: "14px", background: walletAddress ? "linear-gradient(135deg, #7c3aed, #4f46e5)" : "#1e293b", border: "none", borderRadius: "10px", color: walletAddress ? "#fff" : "#475569", fontWeight: "700", fontFamily: "'JetBrains Mono', monospace", fontSize: "13px", cursor: walletAddress ? "pointer" : "default" }}
            >
              ⛓ Register On-Chain
            </button>
            {status !== "idle" && (
              <button
                onClick={reset}
                style={{ padding: "14px 20px", background: "transparent", border: "1px solid #334155", borderRadius: "10px", color: "#64748b", fontFamily: "'JetBrains Mono', monospace", fontSize: "13px", cursor: "pointer" }}
              >
                Reset
              </button>
            )}
          </div>

          {/* Window open alert */}
          {status === "window_open" && (
            <div className="card win" style={{ background: "rgba(34,211,165,0.08)", border: "2px solid #22d3a5", borderRadius: "16px", padding: "24px", marginBottom: "16px", textAlign: "center" }}>
              <div style={{ fontSize: "32px", marginBottom: "8px" }}>🚀</div>
              <div style={{ fontFamily: "'Syne', sans-serif", fontSize: "22px", fontWeight: 800, color: "#22d3a5" }}>Fee Window Open!</div>
              <div style={{ color: "#94a3b8", fontSize: "13px", marginTop: "8px" }}>
                1-hour fee is now <strong style={{ color: "#22d3a5" }}>{fees?.hourFee} sat/vB</strong> — broadcast your transaction now!
              </div>
            </div>
          )}

          {/* Log */}
          <div className="card" style={{ background: "rgba(15,23,42,0.8)", border: "1px solid #1e293b", borderRadius: "16px", padding: "20px", backdropFilter: "blur(12px)" }}>
            <div style={{ fontSize: "11px", color: "#475569", letterSpacing: "2px", textTransform: "uppercase", marginBottom: "12px" }}>Activity Log</div>
            <div style={{ maxHeight: "160px", overflowY: "auto" }}>
              {log.length === 0 ? (
                <div style={{ color: "#334155", fontSize: "12px" }}>No activity yet.</div>
              ) : log.map((entry, i) => (
                <div key={i} style={{ fontSize: "11px", color: entry.includes("❌") ? "#f87171" : entry.includes("✅") || entry.includes("🚀") ? "#22d3a5" : "#64748b", padding: "3px 0", borderBottom: "1px solid #0f172a" }}>
                  {entry}
                </div>
              ))}
            </div>
          </div>

          <div style={{ textAlign: "center", marginTop: "24px", fontSize: "10px", color: "#1e293b" }}>
            Built on OPNet · Bitcoin L2 · mempool.space
          </div>
        </div>
      </div>
    </>
  );
}
