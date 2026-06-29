// page_script.js — Runs in the page's MAIN world (not extension isolated world)
// This allows us to access Chess.com's JavaScript objects directly.
// Injected via a <script> tag from content.js.

(function() {
    'use strict';

    console.log('[ChessBot][PageScript] Initializing in main world...');

    /**
     * Try to find Chess.com's internal board/game controller
     * Chess.com uses a custom web component <wc-chess-board>
     * that may have internal game state attached.
     */
    function findGameController() {
        const board = document.querySelector('wc-chess-board');
        if (!board) return null;

        // Try known property paths that Chess.com has used
        const props = [
            'game', '_game', 'controller', '_controller',
            'chessboard', '_chessboard', 'boardController',
            '_boardController', 'gameController', '_gameController'
        ];

        for (const prop of props) {
            try {
                if (board[prop] && typeof board[prop] === 'object') {
                    console.log(`[ChessBot][PageScript] Found board.${prop}`);
                    return { board, controller: board[prop], path: prop };
                }
            } catch (_) {}
        }

        // Try to find game controller in the board's prototype chain
        try {
            const proto = Object.getPrototypeOf(board);
            if (proto) {
                const descriptors = Object.getOwnPropertyDescriptors(proto);
                for (const [key, desc] of Object.entries(descriptors)) {
                    try {
                        if (desc.get) {
                            const val = desc.get.call(board);
                            if (val && typeof val === 'object' && typeof val.move === 'function') {
                                console.log(`[ChessBot][PageScript] Found move() via prototype getter: ${key}`);
                                return { board, controller: val, path: key };
                            }
                        }
                    } catch (_) {}
                }
            }
        } catch (_) {}

        // Walk all own properties looking for objects with move-related methods
        try {
            const allKeys = Object.keys(board);
            for (const key of allKeys) {
                try {
                    const val = board[key];
                    if (val && typeof val === 'object') {
                        if (typeof val.move === 'function' ||
                            typeof val.makeMove === 'function' ||
                            typeof val.onDropPiece === 'function' ||
                            typeof val.submitMove === 'function') {
                            console.log(`[ChessBot][PageScript] Found move method via key scan: ${key}`);
                            return { board, controller: val, path: key };
                        }
                    }
                } catch (_) {}
            }
        } catch (_) {}

        // Deeply search through non-enumerable and symbol properties
        try {
            const ownProps = Object.getOwnPropertyNames(board);
            for (const key of ownProps) {
                try {
                    const val = board[key];
                    if (val && typeof val === 'object' && !Array.isArray(val)) {
                        if (typeof val.move === 'function' ||
                            typeof val.makeMove === 'function' ||
                            typeof val.onDropPiece === 'function') {
                            console.log(`[ChessBot][PageScript] Found via getOwnPropertyNames: ${key}`);
                            return { board, controller: val, path: key };
                        }
                    }
                } catch (_) {}
            }
        } catch (_) {}

        return null;
    }

    /**
     * Try to make a move using the internal API
     */
    function makeInternalMove(from, to, promotion) {
        const result = findGameController();
        if (!result) {
            console.log('[ChessBot][PageScript] No game controller found');
            return false;
        }

        const { controller } = result;
        const moveStr = from + to + (promotion || '');

        // Try various move method signatures, prioritizing network-emitting ones
        const attempts = [
            // submitMove method (Highest chance of sending to server)
            () => {
                if (typeof controller.submitMove === 'function') {
                    controller.submitMove({ from, to, promotion: promotion || undefined });
                    // Also try arguments format if object format fails internally
                    try { controller.submitMove(from, to, promotion || undefined); } catch(e){}
                    return true;
                }
                return false;
            },
            // onDropPiece method (Usually triggers full UI + network flow)
            () => {
                if (typeof controller.onDropPiece === 'function') {
                    controller.onDropPiece(from, to);
                    return true;
                }
                return false;
            },
            // makeMove method
            () => {
                if (typeof controller.makeMove === 'function') {
                    controller.makeMove({ from, to, promotion: promotion || undefined });
                    return true;
                }
                return false;
            },
            // Object-style move
            () => {
                if (typeof controller.move === 'function') {
                    controller.move({ from, to, promotion: promotion || undefined });
                    return true;
                }
                return false;
            },
            // UCI-style string move (Often just updates local state)
            () => {
                if (typeof controller.move === 'function') {
                    controller.move(moveStr);
                    return true;
                }
                return false;
            }
        ];

        for (const attempt of attempts) {
            try {
                if (attempt()) {
                    console.log(`[ChessBot][PageScript] Move ${moveStr} executed via internal API`);
                    return true;
                }
            } catch (err) {
                console.warn('[ChessBot][PageScript] Move attempt error:', err.message);
            }
        }

        return false;
    }

    // Listen for move requests from the content script
    window.addEventListener('message', (event) => {
        if (!event.data) return;

        // ── Handler: Make a move ────────────────────────────────────────────
        if (event.data.type === 'CHESS_BOT_MAKE_MOVE') {
            const { from, to, promotion } = event.data;
            console.log(`[ChessBot][PageScript] Received move request: ${from}${to}${promotion || ''}`);

            const success = makeInternalMove(from, to, promotion);

            // Send result back to content script
            window.postMessage({
                type: 'CHESS_BOT_MOVE_RESULT',
                success: success
            }, '*');
        }

        // ── Handler: Query player color from Chess.com's internal state ────
        // [FIX 2026-06-29] — Runs in the main world so it can read JS properties
        // on the board element that are NOT reflected as HTML attributes.
        // This is the most reliable color detection method for bot games as Black.
        if (event.data.type === 'CHESS_BOT_GET_PLAYER_COLOR') {
            let color = null;

            try {
                const board = document.querySelector('wc-chess-board');
                if (board) {
                    // Try JS properties first (Angular web component, not HTML attrs)
                    const jsProps = [
                        'orientation', 'playAs', 'playingAs', 'playerColor',
                        'myColor', 'userColor', 'color', 'boardOrientation'
                    ];
                    for (const prop of jsProps) {
                        try {
                            const val = board[prop];
                            if (val === 'black' || val === 2) { color = 'black'; break; }
                            if (val === 'white' || val === 1) { color = 'white'; break; }
                        } catch (_) {}
                    }

                    // Try game controller properties
                    if (!color) {
                        const result = findGameController();
                        if (result) {
                            const { controller } = result;
                            const ctrlProps = [
                                'getPlayingAs', 'getUserColor', 'getMyColor',
                                'getPlayerColor', 'getOrientation'
                            ];
                            for (const prop of ctrlProps) {
                                try {
                                    if (typeof controller[prop] === 'function') {
                                        const val = controller[prop]();
                                        if (val === 'black' || val === 2) { color = 'black'; break; }
                                        if (val === 'white' || val === 1) { color = 'white'; break; }
                                        if (typeof val === 'string' && val.toLowerCase().includes('black')) { color = 'black'; break; }
                                        if (typeof val === 'string' && val.toLowerCase().includes('white')) { color = 'white'; break; }
                                    }
                                } catch (_) {}
                            }
                            // Also try direct properties on the controller
                            if (!color) {
                                const ctrlDirectProps = [
                                    'playingAs', 'playerColor', 'myColor', 'orientation',
                                    'userColor', 'humanColor', 'localColor'
                                ];
                                for (const prop of ctrlDirectProps) {
                                    try {
                                        const val = controller[prop];
                                        if (val === 'black' || val === 2) { color = 'black'; break; }
                                        if (val === 'white' || val === 1) { color = 'white'; break; }
                                    } catch (_) {}
                                }
                            }
                        }
                    }
                }
            } catch (err) {
                console.warn('[ChessBot][PageScript] Color query error:', err);
            }

            console.log('[ChessBot][PageScript] Player color detected:', color || 'unknown');
            window.postMessage({
                type: 'CHESS_BOT_COLOR_RESULT',
                color: color
            }, '*');
        }
    });


    // Notify content script that we're ready
    window.postMessage({ type: 'CHESS_BOT_PAGE_SCRIPT_READY' }, '*');
    console.log('[ChessBot][PageScript] Ready and listening for move commands');
})();
