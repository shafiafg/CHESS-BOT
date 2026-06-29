// content.js — v2.8

// ── Board helpers ─────────────────────────────────────────────────────────
let lastValidFen = null; // Cache for robust FEN generation

function getBoard() {
    return document.querySelector('wc-chess-board') ||
           document.querySelector('#board-layout-main') ||
           document.querySelector('.board');
}

function detectPlayerColor() {
    const board = getBoard();
    if (!board) return null;

    // ── Method 1: 'flipped' CSS class (human vs human, some Chess.com modes) ──
    if (board.classList.contains('flipped')) return 'black';

    // ── Method 2: Read 'orientation' as a JS PROPERTY (not just HTML attribute) ──
    // Chess.com's wc-chess-board is an Angular web component. The property 'orientation'
    // is often set via JavaScript and may NOT be reflected as an HTML attribute.
    // [FIX 2026-06-29] Previous version only checked getAttribute() which misses JS props.
    try {
        const orientProp = board.orientation;
        if (orientProp === 'black') return 'black';
        if (orientProp === 'white') return 'white';
    } catch (_) {}

    // ── Method 3: HTML attributes — standard and Angular ng-reflect variants ──
    const colorAttrs = [
        'orientation', 'ng-reflect-orientation',
        'play-as',     'ng-reflect-play-as',
        'player-color','data-player-color',
        'color',       'ng-reflect-color',
        'board-orientation'
    ];
    for (const attr of colorAttrs) {
        const val = board.getAttribute(attr);
        if (val === 'black') return 'black';
        if (val === 'white') return 'white';
    }

    // ── Method 4: Check parent/ancestor containers for color data ──
    const colorSelectors = [
        '[data-player-color]',
        '[data-color]',
        '[ng-reflect-player-color]',
        '[ng-reflect-orientation]'
    ];
    for (const sel of colorSelectors) {
        const el = document.querySelector(sel);
        if (!el) continue;
        const attrNames = ['data-player-color', 'data-color', 'ng-reflect-player-color', 'ng-reflect-orientation'];
        for (const a of attrNames) {
            const v = el.getAttribute(a);
            if (v === 'black') return 'black';
            if (v === 'white') return 'white';
        }
    }

    // ── Method 5: URL parameters (e.g., /play/computer?color=black) ──
    const urlParams = new URLSearchParams(window.location.search);
    const colorParam = urlParams.get('color') || urlParams.get('playerColor') || urlParams.get('play-as');
    if (colorParam === 'black') return 'black';
    if (colorParam === 'white') return 'white';

    // ── Method 6: Puzzle-specific — use ply parity at game start ──
    // In Chess.com puzzles, ALL the game moves leading to the puzzle position are
    // present in the DOM as [data-ply] nodes. The parity of the LAST ply tells us
    // whose turn it is in the starting position (standard chess parity: even=white, odd=black).
    // This is the player's color because puzzles always start on the player's move.
    // NOTE: This avoids calling getFen()/detectTurn() to prevent circular dependencies.
    const isPuzzle = window.location.pathname.toLowerCase().includes('puzzle');
    if (isPuzzle) {
        const nodes = document.querySelectorAll('[data-ply]');
        if (nodes.length > 0) {
            let maxPly = 0;
            nodes.forEach(n => {
                const p = parseInt(n.getAttribute('data-ply'));
                if (!isNaN(p) && p > maxPly) maxPly = p;
            });
            // After even plies (0,2,4...) white moves next; after odd plies (1,3,5...) black moves.
            // In puzzles, this IS the player's turn → player's color = inferred turn.
            return maxPly % 2 === 0 ? 'white' : 'black';
        }
    }

    // ── Method 7: Bot game inference via ply parity ──
    // In bot games, white ALWAYS moves first. If there is already 1 move in the game
    // (ply=1) and the board update fired without us having moved (isEngineThinking=false),
    // the opponent (white/bot) moved first → we are black.
    // We only use this after at least 1 move has been made.
    if (!isPuzzle) {
        const nodes = document.querySelectorAll('[data-ply]');
        if (nodes.length === 1) {
            // Exactly one move made — if it happened without user interaction, user is black
            // We check this heuristically: if the engine hasn't been thinking, the bot moved
            const firstNode = nodes[0];
            const firstPly = parseInt(firstNode.getAttribute('data-ply'));
            if (firstPly === 1 && !isEngineThinking) {
                // Bot moved first as white → user is black
                return 'black';
            }
        }
    }

    // Default: cannot determine, assume white
    return 'white';
}


// ── FEN generation ────────────────────────────────────────────────────────
function getFen() {
    const board = getBoard();
    if (!board) return lastValidFen; // Return cached FEN if board not found

    const pieces = board.querySelectorAll('.piece');
    if (pieces.length === 0) return lastValidFen; // Return cached if no pieces

    const grid = Array(8).fill(null).map(() => Array(8).fill(null));

    pieces.forEach(p => {
        const classes = p.className.split(' ');
        const typeClass = classes.find(c => c.length === 2 && !c.includes('-'));
        const squareClass = classes.find(c => c.startsWith('square-'));
        if (typeClass && squareClass) {
            const coords = squareClass.split('-')[1];
            const file = parseInt(coords[0]) - 1;
            const rank = 8 - parseInt(coords[1]);
            let char = typeClass[1];
            if (typeClass[0] === 'w') char = char.toUpperCase();
            grid[rank][file] = char;
        }
    });

    let fen = "";
    for (let r = 0; r < 8; r++) {
        let empty = 0;
        for (let f = 0; f < 8; f++) {
            if (grid[r][f]) {
                if (empty > 0) fen += empty;
                fen += grid[r][f];
                empty = 0;
            } else {
                empty++;
            }
        }
        if (empty > 0) fen += empty;
        if (r < 7) fen += "/";
    }

    // --- Intelligent DOM Parsing for Game State ---
    const turn = detectTurn();
    
    // 1. Dynamic Castling Rights Detection
    // We check if the King and Rooks are still on their original squares.
    let castling = "";
    if (grid[7][4] === 'K') { // White King on e1
        if (grid[7][7] === 'R') castling += "K";
        if (grid[7][0] === 'R') castling += "Q";
    }
    if (grid[0][4] === 'k') { // Black King on e8
        if (grid[0][7] === 'r') castling += "k";
        if (grid[0][0] === 'r') castling += "q";
    }
    if (!castling) castling = "-";

    // 2. En Passant Detection (Heuristic via Move List)
    let epSquare = "-";
    const moveNodes = document.querySelectorAll('[data-ply]');
    if (moveNodes.length > 0) {
        const lastMove = moveNodes[moveNodes.length - 1].innerText.trim();
        // If the last move was a 2-square pawn push (e.g., "e4" or "d5" without other chars)
        // Note: This is a simplified check, but highly effective for most games.
        if (lastMove.length === 2 && "abcdefgh".includes(lastMove[0])) {
            const file = lastMove[0];
            const rank = lastMove[1];
            if (turn === 'b' && rank === '4') epSquare = file + "3"; // White just moved to 4th
            if (turn === 'w' && rank === '5') epSquare = file + "6"; // Black just moved to 5th
        }
    }

    const fullFen = `${fen} ${turn} ${castling} ${epSquare} 0 1`;

    // Basic validation: ensure FEN has correct structure
    if (fen.split('/').length === 8 && /^[rnbqkpRNBQKP1-8/]+$/.test(fen)) {
        lastValidFen = fullFen; // Cache valid FEN
    }

    return fullFen;
}

// ── Turn detection via data-ply (move list is the source of truth) ─────────
function detectTurn() {
    const isPuzzle = window.location.pathname.toLowerCase().includes('puzzle');
    const nodes = document.querySelectorAll('[data-ply]');
    
    if (isPuzzle && playerColor) {
        if (nodes.length > 0) {
            let maxPly = 0;
            nodes.forEach(n => {
                const p = parseInt(n.getAttribute('data-ply'));
                if (p > maxPly) maxPly = p;
            });
            // [FIX 2026-06-29] Puzzle turn detection for Black:
            // In puzzles, the board always starts with a "setup" move already played (ply 0).
            // When playing as WHITE: ply 0 = opponent just moved, user's turn.
            //   Even maxPly (0,2,4...) = user (white) to move.
            //   Odd maxPly (1,3,5...) = opponent to move.
            // When playing as BLACK: ply 0 = opponent (white) just moved, user's turn.
            //   Same parity logic applies — even = user's turn regardless of color.
            const isUserTurn = maxPly % 2 === 0;
            if (isUserTurn) {
                return playerColor === 'white' ? 'w' : 'b';
            } else {
                return playerColor === 'white' ? 'b' : 'w';
            }
        }
        // Default to player's turn if no move nodes are loaded yet
        return playerColor === 'white' ? 'w' : 'b';
    }

    if (nodes.length > 0) {
        // Find the absolute highest ply count in the DOM
        let maxPly = 0;
        nodes.forEach(n => {
            const p = parseInt(n.getAttribute('data-ply'));
            if (p > maxPly) maxPly = p;
        });
        // Standard: even ply = white to move, odd ply = black to move.
        // This is always correct for FEN perspective regardless of player color.
        return maxPly % 2 === 0 ? 'w' : 'b';
    }
    return 'w';
}

function isMyTurn() {
    if (!playerColor) return false;
    const turn = detectTurn();
    return (playerColor === 'white' && turn === 'w') ||
           (playerColor === 'black' && turn === 'b');
}

// ── State ─────────────────────────────────────────────────────────────────
let lastFen = "";
let lastPlyCount = 0;
let playerColor = null;
let debounceTimer = null;
let isEngineThinking = false;
let checkBoardActive = false;
let currentCheckFen = null;

// ── Highlights ────────────────────────────────────────────────────────────
function injectHighlightCSS() {
    if (document.getElementById('bot-highlight-css')) return;
    const s = document.createElement('style');
    s.id = 'bot-highlight-css';
    s.textContent = `
        @keyframes botPulse {
            0%, 100% { opacity: 0.55; }
            50%       { opacity: 0.95; }
        }
        .bot-hl {
            position: absolute;
            box-sizing: border-box;
            pointer-events: none;
            border-radius: 3px;
            animation: botPulse 1.8s ease-in-out infinite;
            z-index: 200;
        }
        .bot-hl-from {
            background: rgba(80, 200, 255, 0.30);
            border: 2px solid rgba(80, 200, 255, 0.85);
            box-shadow: inset 0 0 8px rgba(80,200,255,0.2);
        }
        .bot-hl-to {
            background: rgba(80, 255, 160, 0.35);
            border: 2px solid rgba(80, 255, 160, 0.9);
            box-shadow: inset 0 0 8px rgba(80,255,160,0.2);
        }
    `;
    document.head.appendChild(s);
}

function clearHighlights() {
    document.querySelectorAll('.bot-hl').forEach(e => e.remove());
}

function highlightSuggestion(move) {
    const board = getBoard();
    if (!board || !move || move === '(none)') return;
    clearHighlights();
    injectHighlightCSS();

    const from = move.slice(0, 2);
    const to   = move.slice(2, 4);
    const flip = board.classList.contains('flipped');

    function coords(sq) {
        const f = sq.charCodeAt(0) - 97;
        const r = parseInt(sq[1]) - 1;
        return {
            left: (flip ? 7 - f : f) * 12.5 + '%',
            top:  (flip ? r : 7 - r) * 12.5 + '%',
            width: '12.5%',
            height: '12.5%'
        };
    }

    function makeEl(sq, cls) {
        const el = document.createElement('div');
        el.className = `bot-hl ${cls}`;
        const c = coords(sq);
        el.style.left   = c.left;
        el.style.top    = c.top;
        el.style.width  = c.width;
        el.style.height = c.height;
        return el;
    }

    board.appendChild(makeEl(from, 'bot-hl-from'));
    board.appendChild(makeEl(to,   'bot-hl-to'));
}

// ── New-game detection ────────────────────────────────────────────────────
function checkForNewGame() {
    const nodes = document.querySelectorAll('[data-ply]');
    const ply = nodes.length;
    if (ply < lastPlyCount && lastPlyCount > 2) {
        console.log('[ChessBot] New game');
        lastFen = "";
        isEngineThinking = false;
        clearHighlights();
        window.engine.newGame();
        setTimeout(() => {
            playerColor = detectPlayerColor();
            if (playerColor) UI.updatePlayerColor(playerColor);
        }, 400);
    }
    lastPlyCount = ply;
}

// ── Board update pipeline ─────────────────────────────────────────────────
function onBoardUpdate() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        if (currentSettings.paused) return; // Skip if paused

        checkForNewGame();

        const color = detectPlayerColor();
        if (color && color !== playerColor) {
            playerColor = color;
            UI.updatePlayerColor(playerColor);
        }

        const fen = getFen();
        if (!fen || fen === lastFen) return;
        
        UI.renderCurrentBoard(fen);
        
        if (isMyTurn() && isEngineThinking) {
            // Ignore temporary DOM changes (like highlighting/dragging) while already thinking
            return;
        }

        lastFen = fen;
        clearHighlights();
        isEngineThinking = false;

        if (isMyTurn()) {
            const boardEl = getBoard();
            // Try executing any queued premove immediately (internal API preferred)
            try {
                Automation.tryExecutePremove(boardEl).then((executed) => {
                    if (executed) {
                        UI.updateStatus('Premove executed');
                        return;
                    }
                    // No premove executed — run normal analyze
                    UI.updateStatus("Thinking...");
                    isEngineThinking = true;
                    window.engine.analyze(fen);
                }).catch((e) => {
                    console.warn('[ChessBot] Premove attempt error', e);
                    UI.updateStatus("Thinking...");
                    isEngineThinking = true;
                    window.engine.analyze(fen);
                });
            } catch (e) {
                UI.updateStatus("Thinking...");
                isEngineThinking = true;
                window.engine.analyze(fen);
            }

            // Failsafe: if engine hangs for 10 seconds, reset the flag so we don't get stuck
            setTimeout(() => {
                if (isEngineThinking && lastFen === fen) {
                    console.warn('[ChessBot] Thinking timeout reached. Resetting flag.');
                    isEngineThinking = false;
                    UI.updateStatus("Engine timeout - Re-analyzing...");
                    window.engine.analyze(fen); // Try again
                }
            }, 10000);
        } else {
            UI.updateStatus("Opponent's turn (Pondering…)");
            const d = document.getElementById('suggestion-display');
            if (d) d.innerText = '';
            // Using opponent's time to its advantage:
            window.engine.analyze(fen, true); // true = ponder mode
        }
    }, 10); // 10ms for faster bullet highlighting and response
}

// ── Observers ────────────────────────────────────────────────────────────
function observeMoves() {
    const board = getBoard();
    if (!board) { setTimeout(observeMoves, 800); return; }

    new MutationObserver(onBoardUpdate)
        .observe(board, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });

    // Move list is the authoritative source — watch it too
    const ml = document.querySelector('wc-move-list') ||
               document.querySelector('.vertical-move-list-component') ||
               document.querySelector('.move-list-wrapper');
    if (ml) new MutationObserver(onBoardUpdate).observe(ml, { childList: true, subtree: true });
}

// ── Readable move label ───────────────────────────────────────────────────
function moveToReadable(move) {
    if (!move || move === '(none)') return '—';
    const from = move.slice(0, 2).toUpperCase();
    const to   = move.slice(2, 4).toUpperCase();
    const promo = move.length > 4 ? ` =${move[4].toUpperCase()}` : '';
    return `${from} → ${to}${promo}`;
}

// ── Manual suggestion button ──────────────────────────────────────────────
function getPositionNoteText(score, fen) {
    if (score === undefined || score === null) return 'Waiting for engine evaluation...';
    if (typeof score === 'string') return `Info: ${score}`;

    const turn = fen.split(' ')[1] || 'w';
    const magnitude = Math.abs(score);

    if (magnitude < 0.4) {
        return 'Position is balanced.';
    }
    if (turn === 'w') {
        return score > 0
            ? 'White has the advantage.'
            : 'Black has the advantage.';
    }
    return score < 0
        ? 'Black has the advantage.'
        : 'White has the advantage.';
}

function checkBoardPosition() {
    const fen = getFen();
    if (!fen) {
        UI.setCheckBoardStatus('Board not found');
        return;
    }

    currentCheckFen = fen;
    checkBoardActive = true;
    UI.activateTab('analysis');
    UI.renderCheckBoard(fen);
    UI.updateCheckSummary({
        bestMove: 'Waiting...',
        evalScore: '…',
        note: 'Analyzing current position...'
    });
    UI.setCheckBoardStatus('Checking board...');

    window.engine.analyze(fen, false, (move) => {
        if (!checkBoardActive || currentCheckFen !== fen) return;
        const readable = moveToReadable(move);
        UI.updateCheckSummary({
            bestMove: readable,
            evalScore: document.getElementById('check-eval')?.innerText || '—',
            note: `Best move recommendation: ${readable}`
        });
        UI.setCheckBoardStatus('Board checked');
    }, true);
}

document.addEventListener('suggestMove', () => {
    if (isEngineThinking) return; // Stable — don't re-trigger
    const fen = getFen();
    if (!fen) { UI.updateStatus("Board not found"); return; }
    if (!isMyTurn()) { UI.updateStatus("Not your turn"); return; }
    clearHighlights();
    UI.updateStatus("Analyzing…");
    isEngineThinking = true;
    window.engine.analyze(fen);
});

document.addEventListener('checkBoard', () => {
    checkBoardPosition();
});

// ── Page Script Injection (Main World) ────────────────────────────────────
// Inject page_script.js into the page's main world so we can access
// Chess.com's internal game objects for the most reliable auto-play.
function injectPageScript() {
    try {
        const script = document.createElement('script');
        script.src = chrome.runtime.getURL('page_script.js');
        script.onload = () => {
            console.log('[ChessBot] Page script injected successfully');
            script.remove(); // Clean up the <script> tag after execution
        };
        script.onerror = () => {
            console.warn('[ChessBot] Page script injection failed (will rely on pointer events)');
            script.remove();
        };
        (document.head || document.documentElement).appendChild(script);
    } catch (err) {
        console.warn('[ChessBot] Could not inject page script:', err);
    }
}

// ── Bootstrap ─────────────────────────────────────────────────────────────
loadSettings().then(() => {
    // Inject the main-world page script for internal API access
    injectPageScript();

    UI.init();

    // Initial board render
    setTimeout(() => {
        const fen = getFen();
        if (fen) UI.renderCurrentBoard(fen);
    }, 1000);

    // Apply persisted ELO difficulty immediately
    window.engine.setDifficulty(currentSettings.elo);

    // ── Color detection: listen for page_script.js response ──────────────────
    // [FIX 2026-06-29] The page_script runs in Chess.com's main world and can read
    // JS properties on the board element (like board.orientation) that are not
    // reflected as HTML attributes. This is the most reliable detection method.
    window.addEventListener('message', (e) => {
        if (e.data && e.data.type === 'CHESS_BOT_COLOR_RESULT') {
            const detectedColor = e.data.color;
            if (detectedColor && detectedColor !== playerColor) {
                console.log('[ChessBot] Player color confirmed via page_script:', detectedColor);
                playerColor = detectedColor;
                UI.updatePlayerColor(playerColor);
            }
        }
        // When page_script is ready, immediately request player color
        if (e.data && e.data.type === 'CHESS_BOT_PAGE_SCRIPT_READY') {
            setTimeout(() => {
                window.postMessage({ type: 'CHESS_BOT_GET_PLAYER_COLOR' }, '*');
            }, 300); // Small delay to let Chess.com's game state initialize
        }
    });

    // ── Persistent color re-detection loop ───────────────────────────────────
    // Chess.com loads board state asynchronously. We keep re-checking until
    // a definitive non-white color is locked in, or for 30 seconds.
    // [FIX 2026-06-29] — Replaces the single 800ms one-shot detection.
    let colorDetectAttempts = 0;
    const colorDetectInterval = setInterval(() => {
        colorDetectAttempts++;
        if (colorDetectAttempts > 20) { // Stop after 30s (20 * 1.5s)
            clearInterval(colorDetectInterval);
            return;
        }

        // Re-run DOM-based detection
        const domColor = detectPlayerColor();
        if (domColor && domColor !== playerColor) {
            playerColor = domColor;
            UI.updatePlayerColor(playerColor);
            console.log('[ChessBot] Player color updated via DOM re-check:', playerColor);
        }

        // Also re-query page_script each attempt
        window.postMessage({ type: 'CHESS_BOT_GET_PLAYER_COLOR' }, '*');
    }, 1500);

    // Initial fast detection at 500ms and 1200ms
    setTimeout(() => {
        const c = detectPlayerColor();
        if (c) { playerColor = c; UI.updatePlayerColor(playerColor); }
    }, 500);
    setTimeout(() => {
        const c = detectPlayerColor();
        if (c && c !== playerColor) { playerColor = c; UI.updatePlayerColor(playerColor); }
        window.postMessage({ type: 'CHESS_BOT_GET_PLAYER_COLOR' }, '*');
    }, 1200);


    // Listen for pause toggle
    document.addEventListener('togglePause', (e) => {
        currentSettings.paused = e.detail;
    });

    window.engine.onBestMove = (move) => {
        // store raw move for UI actions like premove
        window.lastSuggestedMove = move;
        isEngineThinking = false;
        const readable = moveToReadable(move);
        UI.updateStatus(`♟ ${readable}`);
        UI.updateEngineStatus(window.engine.lastSource || 'Local Engine');

        const d = document.getElementById('suggestion-display');
        if (d) d.innerText = readable;

        if (currentSettings.autoPlay) {
            if (isMyTurn()) {
                Automation.playMove(move);
            } else {
                console.log('[ChessBot] Pondered move finished during opponent turn. Ignoring for autoplay.');
                highlightSuggestion(move);
            }
        } else {
            highlightSuggestion(move);
        }
    };

    window.engine.onEvaluation = (score) => {
        UI.updateEval(score);
        if (checkBoardActive && currentCheckFen) {
            UI.updateCheckSummary({
                evalScore: typeof score === 'number' ? (score > 0 ? `+${score.toFixed(1)}` : score.toFixed(1)) : score,
                note: getPositionNoteText(score, currentCheckFen)
            });
        }
    };

    // Start observing
    setTimeout(observeMoves, 1500);
});
