// offscreen.js — v2.8
// Senior-engineer grade: optimized for stability in iframe environment.
// Lowered Hash and Threads to prevent WASM memory out-of-bounds crashes.

const MOVETIME_MS = {
    "400":  100,
    "800":  200,
    "1600": 500,
    "2000": 1000,
    "2400": 1500,
    "2800": 2000,
    "3000": 3000  // 3 seconds gives depth ~22-26 in WASM — Grandmaster+ level
};

let stockfishWorker = new Worker('stockfish.js');
let currentTabId = null;
let engineReady = false;
let currentMovetime = 750;

// ── Boot: initialize engine once with best-possible settings ──────────────
function bootEngine() {
    stockfishWorker.postMessage('uci');
    // Hash: 16MB. Minimal footprint to prevent WASM memory crashes in restricted iframes.
    stockfishWorker.postMessage('setoption name Hash value 16');
    // Analyse Mode: optimize for search depth over game-playing heuristics
    stockfishWorker.postMessage('setoption name UCI_AnalyseMode value true');
    stockfishWorker.postMessage('setoption name UCI_LimitStrength value true');
    // Move overhead: 50ms. 
    stockfishWorker.postMessage('setoption name Move Overhead value 50');
    // MultiPV 1: focus all power on the single best line
    stockfishWorker.postMessage('setoption name MultiPV value 1');
    // Skill Level: max
    stockfishWorker.postMessage('setoption name Skill Level value 20');
    stockfishWorker.postMessage('isready');
}

let isPondering = false;
let ignoreNextBestMove = false;

// ── Stockfish output handler ──────────────────────────────────────────────
stockfishWorker.onmessage = (e) => {
    const line = e.data;

    if (line === 'readyok' && !engineReady) {
        engineReady = true;
        console.log('[ChessBot] Stockfish engine ready');
    }

    // Auto-Respawn Failsafe for Memory Crashes
    stockfishWorker.onerror = (err) => {
        console.error('[ChessBot] Local Stockfish worker crashed! Auto-restarting...', err);
        stockfishWorker.terminate();
        stockfishWorker = new Worker('stockfish.js');
        engineReady = false;
        bootEngine();
        
        // Re-attach listeners to new worker
        stockfishWorker.onmessage = arguments.callee;
        stockfishWorker.onerror = arguments.callee.onerror;
    };

    if (line.startsWith('bestmove')) {
        if (ignoreNextBestMove) {
            ignoreNextBestMove = false;
            return; // Ignore the bestmove from a cancelled ponder
        }
        isPondering = false;
    }

    // Send to parent iframe if exists, else fallback to extension message
    if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'ENGINE_MSG_FROM_OFFSCREEN', data: line }, '*');
    } else if (currentTabId) {
        try {
            chrome.runtime.sendMessage({
                type: 'ENGINE_MSG_FROM_OFFSCREEN',
                tabId: currentTabId,
                data: line
            }).catch(() => {});
        } catch (_) {}
    }
};

// ── Message router ────────────────────────────────────────────────────────
const handleMessage = (request) => {
    if (request.type === 'ANALYZE_OFFSCREEN') {
        if (request.tabId) currentTabId = request.tabId;
        if (request.movetime) currentMovetime = request.movetime;

        if (isPondering) {
            ignoreNextBestMove = true;
        }
        isPondering = request.ponder || false;

        stockfishWorker.postMessage('stop');
        stockfishWorker.postMessage(`position fen ${request.fen}`);
        
        if (request.ponder) {
            stockfishWorker.postMessage('go infinite');
        } else {
            stockfishWorker.postMessage(`go movetime ${currentMovetime}`);
        }

    } else if (request.type === 'CMD_OFFSCREEN') {
        stockfishWorker.postMessage(request.data);

    } else if (request.type === 'NEW_GAME_OFFSCREEN') {
        stockfishWorker.postMessage('stop');
        stockfishWorker.postMessage('ucinewgame');
        stockfishWorker.postMessage('isready');

    } else if (request.type === 'SET_SKILL_OFFSCREEN') {
        if (request.elo === 3000) {
            stockfishWorker.postMessage('setoption name UCI_LimitStrength value false');
        } else {
            stockfishWorker.postMessage('setoption name UCI_LimitStrength value true');
            if (request.elo !== undefined) {
                stockfishWorker.postMessage(`setoption name UCI_Elo value ${request.elo}`);
            }
        }
        stockfishWorker.postMessage(`setoption name Skill Level value ${request.skill}`);
        stockfishWorker.postMessage('setoption name Threads value 1');
        currentMovetime = request.movetime;
        stockfishWorker.postMessage('isready');

    } else if (request.type === 'SET_HASH_OFFSCREEN') {
        stockfishWorker.postMessage(`setoption name Hash value ${request.mb}`);
        stockfishWorker.postMessage('isready');
    }
};

// Listen to both extension messages AND iframe window messages
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener(handleMessage);
}
window.addEventListener('message', (e) => {
    if (e.data && e.data.type) handleMessage(e.data);
});

// Boot immediately on document load
bootEngine();

if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
    chrome.runtime.sendMessage({ type: 'OFFSCREEN_READY' }).catch(() => {});
}
console.log('[ChessBot] Engine host loaded');
