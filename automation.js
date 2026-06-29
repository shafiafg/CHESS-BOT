// automation.js — v3.0 (Multi-Strategy Auto-Play)
// Fixes auto-play by using Chess.com's actual event system (PointerEvents + drag)
// and an internal API hook injected into the page's main world.

const Automation = {
    // Track which strategy last succeeded so we try it first next time
    _lastSuccessfulStrategy: null,
    // Flag to know if page script is ready
    _pageScriptReady: false,
    // Pending move resolution
    _pendingMoveResolve: null,

    init() {
        // Listen for page script readiness
        window.addEventListener('message', (e) => {
            if (e.data && e.data.type === 'CHESS_BOT_PAGE_SCRIPT_READY') {
                this._pageScriptReady = true;
                console.log('[ChessBot][Automation] Page script bridge ready');
            }
            if (e.data && e.data.type === 'CHESS_BOT_MOVE_RESULT') {
                if (this._pendingMoveResolve) {
                    this._pendingMoveResolve(e.data.success);
                    this._pendingMoveResolve = null;
                }
            }
        });
    },

    // Premove queue: store a single premove and execute when our turn
    _premove: null,

    setPremove(move) {
        this._premove = move;
        console.log('[ChessBot][Automation] Premove queued:', move);
    },

    clearPremove() {
        this._premove = null;
    },

    async tryExecutePremove(board) {
        if (!this._premove) return false;
        if (!isMyTurn || !isMyTurn()) return false;

        const move = this._premove;
        this.clearPremove();

        // Try internal API immediately
        if (await this.tryInternalAPI(move.slice(0,2), move.slice(2,4), move.length>4?move[4]:null)) {
            console.log('[ChessBot][Automation] Premove executed via internal API:', move);
            return true;
        }

        // If internal API fails, try a fast pointer click sequence (client-side only)
        try {
            const from = move.slice(0,2);
            const to = move.slice(2,4);
            const ok = await this.tryPointerClick(from, to, board);
            if (ok) console.log('[ChessBot][Automation] Premove executed via pointer click:', move);
            return ok;
        } catch (e) {
            console.warn('[ChessBot][Automation] Premove failed:', e);
            return false;
        }
    },

    // ── Coordinate helpers ────────────────────────────────────────────────

    algebraicToSquare(alg) {
        const file = alg.charCodeAt(0) - 96; // a=1, b=2, ...
        const rank = parseInt(alg[1]);
        return `square-${file}${rank}`;
    },

    /**
     * Get the board element, checking both regular DOM and Shadow DOM
     */
    getBoard() {
        let board = document.querySelector('wc-chess-board');
        if (board) return board;
        board = document.querySelector('#board-layout-main');
        if (board) return board;
        board = document.querySelector('.board');
        return board;
    },

    /**
     * Check if the board is flipped (playing as black)
     */
    isBoardFlipped(board) {
        if (!board) return false;
        return board.classList.contains('flipped');
    },

    /**
     * Convert algebraic notation (e.g., "e2") to pixel coordinates on the board
     */
    algebraicToPixel(alg, board) {
        const file = alg.charCodeAt(0) - 97; // a=0, b=1, ... h=7
        const rank = parseInt(alg[1]) - 1;     // 1=0, 2=1, ... 8=7

        const rect = board.getBoundingClientRect();
        const squareSize = rect.width / 8;
        const flipped = this.isBoardFlipped(board);

        let x, y;
        if (!flipped) {
            x = (file + 0.5) * squareSize;
            y = (7 - rank + 0.5) * squareSize;
        } else {
            x = (7 - file + 0.5) * squareSize;
            y = (rank + 0.5) * squareSize;
        }

        return {
            clientX: rect.left + x,
            clientY: rect.top + y,
            boardX: x,
            boardY: y
        };
    },

    /**
     * Add human-like jitter to coordinates
     */
    addJitter(coord, maxOffset = 6) {
        return {
            clientX: coord.clientX + (Math.random() - 0.5) * maxOffset,
            clientY: coord.clientY + (Math.random() - 0.5) * maxOffset,
            boardX: coord.boardX,
            boardY: coord.boardY
        };
    },

    // ── Strategy 1: Internal Board API (via page script) ──────────────────

    async tryInternalAPI(from, to, promo) {
        if (!this._pageScriptReady) {
            // Not ready — fail fast so we can fall back to native
            return false;
        }

        return new Promise((resolve) => {
            // Much shorter timeout for bullet — if game controller is present
            // it should respond almost instantly. Fall back quickly.
            const timeout = setTimeout(() => {
                this._pendingMoveResolve = null;
                resolve(false);
            }, 200); // 200ms

            this._pendingMoveResolve = (success) => {
                clearTimeout(timeout);
                resolve(success);
            };

            // Send move request to page script
            window.postMessage({
                type: 'CHESS_BOT_MAKE_MOVE',
                from: from,
                to: to,
                promotion: promo
            }, '*');
        });
    },

    // Fast native click proxy (uses background -> python /click_fast)
    async tryPythonMouseServerFast(from, to, board) {
        const fromCoord = this.algebraicToPixel(from, board);
        const toCoord = this.algebraicToPixel(to, board);

        return new Promise((resolve) => {
            const payload = {
                x1: fromCoord.clientX,
                y1: fromCoord.clientY,
                x2: toCoord.clientX,
                y2: toCoord.clientY,
                screenX: window.screenX,
                screenY: window.screenY,
                outerHeight: window.outerHeight,
                innerHeight: window.innerHeight
            };

            chrome.runtime.sendMessage({ type: 'PROXY_PYTHON_DRAG_FAST', payload }, (response) => {
                if (chrome.runtime.lastError) {
                    console.error('[ChessBot][Automation] Extension messaging error:', chrome.runtime.lastError);
                    resolve(false);
                } else if (response && response.success) {
                    resolve(true);
                } else {
                    console.error('[ChessBot][Automation] Python fast mouse server failed:', response?.error);
                    resolve(false);
                }
            });
        });
    },

    // ── Strategy 2: PointerEvent Drag Simulation ──────────────────────────

    /**
     * Create a PointerEvent with all the properties Chess.com expects
     */
    createPointerEvent(type, x, y, extra = {}) {
        return new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            composed: true,        // Crosses Shadow DOM boundaries
            view: window,
            clientX: x,
            clientY: y,
            screenX: x + window.screenX,
            screenY: y + window.screenY,
            pageX: x + window.scrollX,
            pageY: y + window.scrollY,
            pointerId: 1,
            pointerType: 'mouse',
            isPrimary: true,
            pressure: type === 'pointerup' ? 0 : 0.5,
            width: 1,
            height: 1,
            button: 0,
            buttons: type === 'pointerup' ? 0 : 1,
            ...extra
        });
    },

    /**
     * Create a MouseEvent as companion to PointerEvent
     */
    createMouseEvent(type, x, y) {
        return new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            composed: true,
            view: window,
            clientX: x,
            clientY: y,
            screenX: x + window.screenX,
            screenY: y + window.screenY,
            pageX: x + window.scrollX,
            pageY: y + window.scrollY,
            button: 0,
            buttons: type === 'mouseup' ? 0 : 1
        });
    },

    /**
     * Generate intermediate points for a human-like drag path
     */
    generateDragPath(startX, startY, endX, endY, steps = 5) {
        const points = [];
        for (let i = 1; i <= steps; i++) {
            const t = i / steps;
            // Slight curve using quadratic easing
            const ease = t * (2 - t);
            const jitterX = (Math.random() - 0.5) * 4;
            const jitterY = (Math.random() - 0.5) * 4;
            points.push({
                x: startX + (endX - startX) * ease + jitterX,
                y: startY + (endY - startY) * ease + jitterY
            });
        }
        return points;
    },

    // ── Strategy 2: Python Mouse Server (Native Linux/Windows Mouse) ──

    async tryPythonMouseServer(from, to, board) {
        const fromCoord = this.addJitter(this.algebraicToPixel(from, board));
        const toCoord = this.addJitter(this.algebraicToPixel(to, board));

        return new Promise((resolve) => {
            const payload = {
                x1: fromCoord.clientX,
                y1: fromCoord.clientY,
                x2: toCoord.clientX,
                y2: toCoord.clientY,
                screenX: window.screenX,
                screenY: window.screenY,
                outerHeight: window.outerHeight,
                innerHeight: window.innerHeight
            };

            chrome.runtime.sendMessage({ type: 'PROXY_PYTHON_DRAG', payload }, (response) => {
                if (chrome.runtime.lastError) {
                    console.error('[ChessBot][Automation] Extension messaging error:', chrome.runtime.lastError);
                    alert("ERROR: Could not communicate with the background script. Please reload the extension.");
                    resolve(false);
                } else if (response && response.success) {
                    console.log('[ChessBot][Automation] Python native drag completed');
                    resolve(true);
                } else {
                    console.error('[ChessBot][Automation] Python mouse server not running or failed:', response?.error);
                    alert("ERROR: The Python Mouse Server is not running! Please run 'python3 mouse_server.py' in your terminal.");
                    resolve(false);
                }
            });
        });
    },

    // ── Strategy 3: PointerEvent Drag Simulation ──────────────────────────

    /**
     * Perform a full pointer-event drag from one square to another
     */
    async tryPointerDrag(from, to, board) {
        const fromCoord = this.addJitter(this.algebraicToPixel(from, board));
        const toCoord = this.addJitter(this.algebraicToPixel(to, board));

        // Find the element at the starting position
        const startEl = document.elementFromPoint(fromCoord.clientX, fromCoord.clientY);
        if (!startEl) {
            console.log('[ChessBot][Automation] No element at start position');
            return false;
        }

        try {
            // 1. pointerdown + mousedown at source
            startEl.dispatchEvent(this.createPointerEvent('pointerdown', fromCoord.clientX, fromCoord.clientY));
            startEl.dispatchEvent(this.createMouseEvent('mousedown', fromCoord.clientX, fromCoord.clientY));

            // 2. Small delay to simulate human reaction
            await new Promise(r => setTimeout(r, 30 + Math.random() * 50));

            // 3. Generate and dispatch drag path (pointermove + mousemove)
            const path = this.generateDragPath(
                fromCoord.clientX, fromCoord.clientY,
                toCoord.clientX, toCoord.clientY,
                4 + Math.floor(Math.random() * 3)
            );

            for (const point of path) {
                const moveEl = document.elementFromPoint(point.x, point.y) || startEl;
                moveEl.dispatchEvent(this.createPointerEvent('pointermove', point.x, point.y));
                moveEl.dispatchEvent(this.createMouseEvent('mousemove', point.x, point.y));
                await new Promise(r => setTimeout(r, 10 + Math.random() * 20));
            }

            // 4. pointerup + mouseup at destination
            const endEl = document.elementFromPoint(toCoord.clientX, toCoord.clientY) || startEl;
            endEl.dispatchEvent(this.createPointerEvent('pointerup', toCoord.clientX, toCoord.clientY));
            endEl.dispatchEvent(this.createMouseEvent('mouseup', toCoord.clientX, toCoord.clientY));

            console.log('[ChessBot][Automation] Pointer drag completed');
            return true;
        } catch (err) {
            console.error('[ChessBot][Automation] Pointer drag failed:', err);
            return false;
        }
    },

    // ── Strategy 3: Click-based with PointerEvents ────────────────────────
    // (Some Chess.com versions support click-click: click source, click dest)

    async tryPointerClick(from, to, board) {
        const fromCoord = this.addJitter(this.algebraicToPixel(from, board));
        const toCoord = this.addJitter(this.algebraicToPixel(to, board));

        try {
            // Click source square
            const fromEl = document.elementFromPoint(fromCoord.clientX, fromCoord.clientY);
            if (!fromEl) return false;

            fromEl.dispatchEvent(this.createPointerEvent('pointerdown', fromCoord.clientX, fromCoord.clientY));
            fromEl.dispatchEvent(this.createMouseEvent('mousedown', fromCoord.clientX, fromCoord.clientY));
            await new Promise(r => setTimeout(r, 30 + Math.random() * 30));
            fromEl.dispatchEvent(this.createPointerEvent('pointerup', fromCoord.clientX, fromCoord.clientY));
            fromEl.dispatchEvent(this.createMouseEvent('mouseup', fromCoord.clientX, fromCoord.clientY));
            fromEl.dispatchEvent(this.createMouseEvent('click', fromCoord.clientX, fromCoord.clientY));

            // Wait for piece selection highlight
            await new Promise(r => setTimeout(r, 100 + Math.random() * 100));

            // Click destination square
            const toEl = document.elementFromPoint(toCoord.clientX, toCoord.clientY);
            if (!toEl) return false;

            toEl.dispatchEvent(this.createPointerEvent('pointerdown', toCoord.clientX, toCoord.clientY));
            toEl.dispatchEvent(this.createMouseEvent('mousedown', toCoord.clientX, toCoord.clientY));
            await new Promise(r => setTimeout(r, 30 + Math.random() * 30));
            toEl.dispatchEvent(this.createPointerEvent('pointerup', toCoord.clientX, toCoord.clientY));
            toEl.dispatchEvent(this.createMouseEvent('mouseup', toCoord.clientX, toCoord.clientY));
            toEl.dispatchEvent(this.createMouseEvent('click', toCoord.clientX, toCoord.clientY));

            console.log('[ChessBot][Automation] Pointer click-click completed');
            return true;
        } catch (err) {
            console.error('[ChessBot][Automation] Pointer click failed:', err);
            return false;
        }
    },

    // ── Strategy 4: Direct board method invocation (on the element) ───────

    async tryBoardElementAPI(from, to, promo, board) {
        try {
            // Some versions of wc-chess-board expose a game or controller
            // Try various known property names
            const possiblePaths = [
                () => board.game,
                () => board._game,
                () => board.controller,
                () => board._controller,
                () => board.chessboard,
                () => board._chessboard,
            ];

            for (const getObj of possiblePaths) {
                try {
                    const obj = getObj();
                    if (!obj) continue;

                    // Try common move methods, prioritizing those that emit to the server
                    const moveStr = from + to + (promo || '');
                    
                    if (typeof obj.submitMove === 'function') {
                        obj.submitMove({ from, to, promotion: promo });
                        try { obj.submitMove(from, to, promo); } catch(e){}
                        console.log('[ChessBot][Automation] Board element API submitMove() succeeded');
                        return true;
                    }
                    if (typeof obj.onDropPiece === 'function') {
                        obj.onDropPiece(from, to);
                        console.log('[ChessBot][Automation] Board element API onDropPiece() succeeded');
                        return true;
                    }
                    if (typeof obj.makeMove === 'function') {
                        obj.makeMove({ from, to, promotion: promo });
                        console.log('[ChessBot][Automation] Board element API makeMove() succeeded');
                        return true;
                    }
                    if (typeof obj.move === 'function') {
                        obj.move(moveStr);
                        console.log('[ChessBot][Automation] Board element API move() succeeded');
                        return true;
                    }
                } catch (_) { /* silently try next */ }
            }

            return false;
        } catch (err) {
            console.error('[ChessBot][Automation] Board element API failed:', err);
            return false;
        }
    },

    // ── Promotion handler ─────────────────────────────────────────────────

    async handlePromotion(promo, board) {
        if (!promo) return;

        // Wait for the promotion popup to appear
        await new Promise(r => setTimeout(r, 300 + Math.random() * 200));

        const flipped = this.isBoardFlipped(board);
        const colorChar = flipped ? 'b' : 'w';
        const promoPieceType = colorChar + promo.toLowerCase(); // e.g., 'wq'

        // Try various selector patterns Chess.com has used
        const selectors = [
            `.promotion-piece[data-piece="${promoPieceType}"]`,
            `.promotion-piece.${promoPieceType}`,
            `.promotion-window .${promoPieceType}`,
            `[data-piece="${promoPieceType}"]`,
            `.promotion-menu .${promoPieceType}`,
            `.promotion-area .${promoPieceType}`,
        ];

        let clicked = false;
        for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el) {
                const rect = el.getBoundingClientRect();
                const cx = rect.left + rect.width / 2;
                const cy = rect.top + rect.height / 2;

                el.dispatchEvent(this.createPointerEvent('pointerdown', cx, cy));
                el.dispatchEvent(this.createMouseEvent('mousedown', cx, cy));
                await new Promise(r => setTimeout(r, 40));
                el.dispatchEvent(this.createPointerEvent('pointerup', cx, cy));
                el.dispatchEvent(this.createMouseEvent('mouseup', cx, cy));
                el.dispatchEvent(this.createMouseEvent('click', cx, cy));

                clicked = true;
                console.log('[ChessBot][Automation] Promotion piece clicked:', sel);
                break;
            }
        }

        // Fallback: click the first promotion option (usually Queen)
        if (!clicked) {
            const fallback = document.querySelector('.promotion-piece, .promotion-window .piece, .promotion-area .piece');
            if (fallback) {
                const rect = fallback.getBoundingClientRect();
                const cx = rect.left + rect.width / 2;
                const cy = rect.top + rect.height / 2;

                fallback.dispatchEvent(this.createPointerEvent('pointerdown', cx, cy));
                fallback.dispatchEvent(this.createMouseEvent('mousedown', cx, cy));
                await new Promise(r => setTimeout(r, 40));
                fallback.dispatchEvent(this.createPointerEvent('pointerup', cx, cy));
                fallback.dispatchEvent(this.createMouseEvent('mouseup', cx, cy));
                fallback.dispatchEvent(this.createMouseEvent('click', cx, cy));
                console.log('[ChessBot][Automation] Promotion fallback clicked');
            }
        }
    },

    // ── Main entry point ──────────────────────────────────────────────────

    async playMove(move) {
        if (!currentSettings.autoPlay) return;

        // Ensure it is our turn before making a move
        if (typeof isMyTurn === 'function' && !isMyTurn()) {
            console.log('[ChessBot][Automation] Not my turn. Skipping pre-move.');
            return;
        }

        const from = move.substring(0, 2);
        const to = move.substring(2, 4);
        const promo = move.length > 4 ? move[4] : null;

        console.log(`[ChessBot][Automation] Playing move: ${from}${to}${promo || ''}`);

        // For bullet we want minimal delay. Only wait when humanizer is enabled.
        if (currentSettings.humanizer) {
            const baseDelay = 300; // modest humanizer when enabled
            const humanDelay = baseDelay + Math.random() * 200;
            await new Promise(r => setTimeout(r, humanDelay));
        }

        const board = this.getBoard();
        if (!board) {
            console.error('[ChessBot][Automation] Board not found!');
            return;
        }

        // Define strategy order: try internal API first (fast, server-emitting),
        // then a fast native click fallback.
        const strategies = [
            { name: 'internalAPI', fn: () => this.tryInternalAPI(from, to, promo) },
            { name: 'pythonFast',  fn: () => this.tryPythonMouseServerFast(from, to, board) },
            { name: 'python',      fn: () => this.tryPythonMouseServer(from, to, board) }
        ];

        let success = false;
        for (const strategy of strategies) {
            console.log(`[ChessBot][Automation] Trying strategy: ${strategy.name}`);
            try {
                success = await strategy.fn();
                if (success) {
                    this._lastSuccessfulStrategy = strategy.name;
                    console.log(`[ChessBot][Automation] ✓ Strategy "${strategy.name}" succeeded`);
                    break;
                }
            } catch (err) {
                console.warn(`[ChessBot][Automation] Strategy "${strategy.name}" error:`, err);
            }
        }

        if (!success) {
            console.warn('[ChessBot][Automation] All strategies failed for move:', move);
        }

        // Handle promotion if needed (for pointer-based strategies)
        if (success && promo && this._lastSuccessfulStrategy !== 'internalAPI') {
            await this.handlePromotion(promo, board);
        }
    }
};

// Initialize on load
Automation.init();
