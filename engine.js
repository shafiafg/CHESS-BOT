// engine.js — v2.8 (Cloud Engine Architecture)
// Proxy between content scripts, local WASM ponder engine, and the primary Cloud API.

const MOVETIME_BY_ELO = {
    "400":  100,
    "800":  200,
    "1200": 300,
    "1600": 500,
    "2000": 500,
    "2400": 500,
    "2800": 500,
    "3000": 500
};

class ChessEngine {
    constructor() {
        this.onBestMove = null;
        this.onEvaluation = null;
        this.currentMovetime = 750;
        this._lastInfo = null;
        this.iframe = null;
        this.iframeReady = false;
        this.messageQueue = [];
        this.currentEloDepth = 20;
        this.analysisId = 0;
        this.lastSource = 'Local Engine';
        this._pendingAnalysisCallback = null;
        this._pendingAnalysisId = null;
        this._suppressBestMove = false;
        
        // Match Memory Storage: Keeps a picture of the board history
        this.gameHistory = [];

        this._injectIframe();

        window.addEventListener('message', (event) => {
            if (!event.data || event.data.type !== 'ENGINE_MSG_FROM_OFFSCREEN') return;
            const line = event.data.data;

            if (line.startsWith('info') && line.includes('score')) {
                this._lastInfo = line;
                const cpMatch = line.match(/score cp (-?\d+)/);
                const mateMatch = line.match(/score mate (-?\d+)/);
                if (cpMatch && this.onEvaluation) {
                    this.onEvaluation(parseInt(cpMatch[1]) / 100);
                } else if (mateMatch && this.onEvaluation) {
                    this.onEvaluation(`M${mateMatch[1]}`);
                }
            } else if (line.startsWith('bestmove')) {
                const parts = line.split(' ');
                const move = parts[1];
                if (this._pendingAnalysisCallback && this._pendingAnalysisId === this.analysisId) {
                    try {
                        this._pendingAnalysisCallback(move || null);
                    } finally {
                        this._pendingAnalysisCallback = null;
                        this._pendingAnalysisId = null;
                    }
                }
                if (this.onBestMove && this.analysisId !== -1 && !this._suppressBestMove) {
                    this.onBestMove(move || null);
                }
            }
        });
    }

    _injectIframe() {
        if (document.getElementById('chess-bot-engine-iframe')) return;
        
        this.iframe = document.createElement('iframe');
        this.iframe.id = 'chess-bot-engine-iframe';
        this.iframe.src = chrome.runtime.getURL('offscreen.html');
        this.iframe.style.display = 'none';
        
        this.iframe.onload = () => {
            this.iframeReady = true;
            console.log('[ChessBot] Local engine iframe ready');
            // Flush queue
            for (const msg of this.messageQueue) {
                this._postMessage(msg);
            }
            this.messageQueue = [];
        };

        document.body.appendChild(this.iframe);
    }

    _postMessage(msg) {
        if (!this.iframeReady || !this.iframe || !this.iframe.contentWindow) {
            this.messageQueue.push(msg);
            return;
        }
        this.iframe.contentWindow.postMessage(msg, '*');
    }

    async _retryFetch(url, options, maxRetries = 3, baseDelay = 500) {
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                const response = await fetch(url, options);
                if (response.ok) return response;
                if (attempt === maxRetries - 1) return response; // Return last failed response
            } catch (err) {
                if (attempt === maxRetries - 1) throw err;
            }
            // Exponential backoff
            const delay = baseDelay * Math.pow(2, attempt);
            await new Promise(r => setTimeout(r, delay));
        }
    }

    async analyze(fen, ponder = false, callback = null, noNotify = false) {
        this.analysisId = (this.analysisId || 0) + 1;
        const currentId = this.analysisId;
        this.lastSource = 'Local Engine'; // Default to local
        this._pendingAnalysisCallback = callback;
        this._pendingAnalysisId = callback ? currentId : null;
        this._suppressBestMove = Boolean(noNotify);

        // Save to match memory if it's a new board picture
        if (this.gameHistory.length === 0 || this.gameHistory[this.gameHistory.length - 1] !== fen) {
            this.gameHistory.push(fen);
            if (this.gameHistory.length > 500) this.gameHistory.shift(); // Limit history to prevent memory issues
            console.log(`[ChessBot] Match Memory Updated. Move ${this.gameHistory.length}`);
        }

        // Always send to local engine for continuous evaluation bar updates and pondering
        this._postMessage({
            type: 'ANALYZE_OFFSCREEN',
            fen,
            movetime: this.currentMovetime,
            ponder
        });

        // Local-only: no cloud API calls for full customization
    }

    setDifficulty(eloKey) {
        const config = ELO_CONFIG[eloKey];
        this.currentMovetime = MOVETIME_BY_ELO[eloKey] || 750;
        
        const depthByElo = {
            "400": 1, "800": 3, "1200": 5, "1600": 8, "2000": 12, "2400": 15, "2800": 20, "3000": 24
        };
        this.currentEloDepth = depthByElo[eloKey] || 15;

        this._postMessage({
            type: 'SET_SKILL_OFFSCREEN',
            skill: config.skill,
            elo: Number(eloKey),
            movetime: this.currentMovetime
        });
    }

    newGame() {
        this.gameHistory = []; // Clear memory on new match
        this._postMessage({ type: 'NEW_GAME_OFFSCREEN' });
    }

    stop() {
        this._postMessage({ type: 'CMD_OFFSCREEN', data: 'stop' });
    }
}

const engine = new ChessEngine();
window.engine = engine;
