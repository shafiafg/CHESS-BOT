const UI = {
    playerColor: null,
    canvas: null,
    ctx: null,
    raf: null,
    particles: [],
    mouseX: 0,
    mouseY: 0,
    W: 0,
    H: 0,

    init() {
        if (document.getElementById('chess-bot-overlay')) return;

        // Load settings from storage
        chrome.storage.local.get(['elo', 'humanizer', 'moveDelay', 'showSuggestions', 'paused'], (result) => {
            if (result.elo && ELO_CONFIG[result.elo]) currentSettings.elo = result.elo;
            if (result.humanizer !== undefined) currentSettings.humanizer = result.humanizer;
            if (result.moveDelay !== undefined) currentSettings.moveDelay = result.moveDelay;
            if (result.showSuggestions !== undefined) currentSettings.showSuggestions = result.showSuggestions;
            if (result.paused !== undefined) currentSettings.paused = result.paused;
        });

        const container = document.createElement('div');
        container.id = 'chess-bot-overlay';
        container.innerHTML = `
            <canvas id="bot-particle-canvas"></canvas>
            <div class="overlay-content">
                <h2>Chess Bot <span>⚡</span></h2>
                <div class="version-bar">
                    <span>v3.0</span>
                    <span id="engine-status"><span class="status-dot"></span>Local Engine</span>
                </div>

                <div class="tab-bar">
                    <button class="tab-btn active" data-tab="bot">Bot</button>
                    <button class="tab-btn" data-tab="board">Board</button>
                </div>

                <div class="tab-content active" id="bot-tab">
                    <div class="player-color-badge" id="player-color-badge">
                        <div class="color-icon" id="color-icon"></div>
                        <div class="color-text">Playing as <span id="color-label">detecting…</span></div>
                    </div>

                    <!--
                        [FRONTEND HIDDEN — 2026-06-29]
                        Auto-Play toggle removed from UI on user request.
                        The autoPlay setting and all backend logic remain fully functional.
                        This option is NOT in the frontend yet — do not re-add without updating bindEvents.
                    -->
                    <!-- <div class="bot-row">
                        <span class="bot-label">Auto-Play</span>
                        <label class="switch">
                            <input type="checkbox" id="autoplay-toggle">
                            <span class="slider-switch"></span>
                        </label>
                    </div> -->

                    <div class="bot-row">
                        <span class="bot-label">Humanizer</span>
                        <label class="switch">
                            <input type="checkbox" id="humanizer-toggle" checked>
                            <span class="slider-switch"></span>
                        </label>
                    </div>

                    <!--
                        [FRONTEND HIDDEN — 2026-06-29]
                        Bullet Mode toggle removed from UI on user request.
                        The bulletMode setting and all backend logic remain fully functional.
                        This option is NOT in the frontend yet — do not re-add without updating bindEvents.
                    -->
                    <!-- <div class="bot-row">
                        <span class="bot-label">Bullet Mode</span>
                        <label class="switch">
                            <input type="checkbox" id="bullet-toggle">
                            <span class="slider-switch"></span>
                        </label>
                    </div> -->

                    <div class="bot-row" style="flex-direction:column;align-items:flex-start;">
                        <span class="bot-label">ELO Difficulty</span>
                        <select id="elo-select">
                            ${Object.keys(ELO_CONFIG).map(k =>
                                `<option value="${k}" ${k === currentSettings.elo ? 'selected' : ''}>${ELO_CONFIG[k].label}</option>`
                            ).join('')}
                        </select>
                    </div>

                    <div class="bot-row" style="flex-direction:column;align-items:flex-start;">
                        <span class="bot-label">Engine Think Time: <span id="delay-val">${(currentSettings.moveDelay/1000).toFixed(1)}</span>s</span>
                        <input type="range" id="delay-slider" min="100" max="10000" step="100" value="${currentSettings.moveDelay}">
                    </div>

                    <div class="bot-divider"></div>

                    <div class="bot-row" style="margin-top:0; gap: 10px; flex-wrap: wrap;">
                        <button id="suggest-btn" class="suggest-btn">⚡ Get Suggestion</button>
                        <button id="check-board-btn" class="suggest-btn">🧠 Check Board</button>
                        <!--
                            [FRONTEND HIDDEN — 2026-06-29]
                            Queue Premove button removed from UI on user request.
                            The premove queue (Automation.setPremove / tryExecutePremove) remains fully
                            functional in the backend. This option is NOT in the frontend yet.
                        -->
                        <!-- <button id="premove-btn" class="suggest-btn">🎯 Queue Premove</button> -->
                        <button id="pause-btn" class="suggest-btn" style="background: ${currentSettings.paused ? '#4ecdc4' : '#ff6b6b'};">${currentSettings.paused ? '▶️ Resume' : '⏸️ Pause'}</button>
                    </div>

                    <div id="suggestion-display" class="suggestion-display"></div>
                    <div class="evaluation" id="eval-display">0.0</div>
                    <div class="status" id="bot-status">Engine Ready</div>
                </div>

                <div class="tab-content" id="board-tab">
                    <div class="check-panel" id="current-board-panel">
                        <div class="check-panel-header">Current Board</div>
                        <div class="board-check-container" id="current-board-container"></div>
                        <div class="check-meta" id="current-board-meta">
                            <div class="check-row"><span>FEN</span><span id="current-fen">—</span></div>
                            <div class="check-row"><span>Turn</span><span id="current-turn">—</span></div>
                        </div>
                    </div>
                </div>
            </div>
            <div class="resize-handle" id="resize-handle"></div>
        `;

        document.body.appendChild(container);
        document.getElementById('humanizer-toggle').checked = currentSettings.humanizer;
        // [FRONTEND HIDDEN — 2026-06-29] bullet-toggle and autoplay-toggle are not rendered in the UI.
        // Their backend settings (currentSettings.bulletMode / currentSettings.autoPlay) are still active.
        // document.getElementById('bullet-toggle').checked = currentSettings.bulletMode;
        // document.getElementById('autoplay-toggle').checked = currentSettings.autoPlay;

        this.initParticles(container);
        this.makeDraggable(container);
        this.makeResizable(container);
        this.bindEvents();
        this.detectPlayerColor();
    },

    // ── Particle visual system ─────────────────────────────────────────────
    initParticles(container) {
        this.canvas = document.getElementById('bot-particle-canvas');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');

        const sync = () => {
            this.W = this.canvas.width  = container.offsetWidth;
            this.H = this.canvas.height = container.offsetHeight;
            if (!this.particles || this.particles.length === 0) {
                this.spawnParticles();
            }
        };
        sync();
        if (window.ResizeObserver) new ResizeObserver(sync).observe(container);

        this.drawLoop();
    },

    spawnParticles() {
        this.particles = [];
        const count = 10;
        for (let i = 0; i < count; i++) {
            this.particles.push({
                x: Math.random() * this.W,
                y: Math.random() * this.H,
                vx: (Math.random() - 0.5) * 0.4,
                vy: (Math.random() - 0.5) * 0.4,
                baseRadius: 8 + Math.random() * 10,
                hue: 150 + Math.random() * 40,
                alpha: 0.22 + Math.random() * 0.18,
                phase: Math.random() * Math.PI * 2
            });
        }
    },

    drawLoop() {
        const ctx = this.ctx;
        if (!ctx) return;

        ctx.clearRect(0, 0, this.W, this.H);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';

        const centerX = this.W / 2;
        const centerY = this.H / 2;

        for (const particle of this.particles) {
            particle.phase += 0.018;
            particle.x += particle.vx;
            particle.y += particle.vy;

            if (particle.x < -particle.baseRadius) particle.x = this.W + particle.baseRadius;
            if (particle.x > this.W + particle.baseRadius) particle.x = -particle.baseRadius;
            if (particle.y < -particle.baseRadius) particle.y = this.H + particle.baseRadius;
            if (particle.y > this.H + particle.baseRadius) particle.y = -particle.baseRadius;

            const attraction = 0.02;
            particle.x += (centerX - particle.x) * attraction * 0.12;
            particle.y += (centerY - particle.y) * attraction * 0.12;

            const pulse = 0.8 + Math.sin(particle.phase) * 0.25;
            const radius = particle.baseRadius * pulse;
            const alpha = particle.alpha * (0.6 + Math.sin(particle.phase * 1.2) * 0.25);

            ctx.beginPath();
            ctx.arc(particle.x, particle.y, radius, 0, Math.PI * 2);
            ctx.fillStyle = `hsla(${particle.hue}, 85%, 70%, ${alpha.toFixed(3)})`;
            ctx.shadowBlur = 16;
            ctx.shadowColor = `hsla(${particle.hue}, 90%, 80%, ${alpha.toFixed(3)})`;
            ctx.fill();
            ctx.shadowBlur = 0;
        }

        ctx.restore();
        this.raf = requestAnimationFrame(() => this.drawLoop());
    },

    // ── Events ──────────────────────────────────────────────────────────────
    bindEvents() {
        // [FRONTEND HIDDEN — 2026-06-29] autoplay-toggle is not in the UI; listener disabled.
        // Backend: currentSettings.autoPlay is still read by content.js and automation.js.
        // This option is NOT in the frontend yet.
        // document.getElementById('autoplay-toggle').addEventListener('change', (e) => {
        //     currentSettings.autoPlay = e.target.checked;
        //     this.saveSettings();
        // });
        document.getElementById('humanizer-toggle').addEventListener('change', (e) => {
            currentSettings.humanizer = e.target.checked; 
            this.saveSettings();
        });
        // [FRONTEND HIDDEN — 2026-06-29] bullet-toggle is not in the UI; listener disabled.
        // Backend: currentSettings.bulletMode is still read by automation.js.
        // This option is NOT in the frontend yet.
        // document.getElementById('bullet-toggle').addEventListener('change', (e) => {
        //     currentSettings.bulletMode = e.target.checked;
        //     this.saveSettings();
        // });
        document.getElementById('elo-select').addEventListener('change', (e) => {
            currentSettings.elo = e.target.value;
            window.engine.setDifficulty(e.target.value);
            this.saveSettings();
        });
        const slider = document.getElementById('delay-slider');
        const val    = document.getElementById('delay-val');
        slider.addEventListener('input', (e) => {
            currentSettings.moveDelay = parseInt(e.target.value);
            val.innerText = (e.target.value / 1000).toFixed(1);
            if (window.engine) {
                window.engine.currentMovetime = currentSettings.moveDelay;
            }
        });
        slider.addEventListener('change', () => this.saveSettings());

        const btn = document.getElementById('suggest-btn');
        if (btn) btn.addEventListener('click', () => {
            btn.style.transform = 'scale(0.96)';
            setTimeout(() => btn.style.transform = '', 140);
            document.dispatchEvent(new Event('suggestMove'));
        });

        // [FRONTEND HIDDEN — 2026-06-29] premove-btn is not rendered in the UI; listener disabled.
        // Backend: Automation.setPremove() and tryExecutePremove() remain fully functional.
        // This option is NOT in the frontend yet.
        // const premoveBtn = document.getElementById('premove-btn');
        // if (premoveBtn) premoveBtn.addEventListener('click', () => {
        //     const move = window.lastSuggestedMove;
        //     if (!move) {
        //         this.updateStatus('No suggestion to queue');
        //         return;
        //     }
        //     Automation.setPremove(move);
        //     this.updateStatus('Premove queued: ' + moveToReadable(move));
        // });

        const checkBtn = document.getElementById('check-board-btn');
        if (checkBtn) checkBtn.addEventListener('click', () => {
            checkBtn.style.transform = 'scale(0.96)';
            setTimeout(() => checkBtn.style.transform = '', 140);
            UI.activateTab('board');
            document.dispatchEvent(new Event('checkBoard'));
        });

        const tabButtons = document.querySelectorAll('.tab-btn');
        tabButtons.forEach((button) => {
            button.addEventListener('click', () => this.activateTab(button.dataset.tab));
        });

        const pauseBtn = document.getElementById('pause-btn');
        if (pauseBtn) pauseBtn.addEventListener('click', () => {
            // Toggle pause state
            currentSettings.paused = !currentSettings.paused;
            pauseBtn.innerText = currentSettings.paused ? '▶️ Resume' : '⏸️ Pause';
            pauseBtn.style.background = currentSettings.paused ? '#4ecdc4' : '#ff6b6b';
            this.saveSettings();
            // Dispatch event to notify content script
            document.dispatchEvent(new CustomEvent('togglePause', { detail: currentSettings.paused }));
        });
    },

    saveSettings() {
        chrome.storage.local.set({
            elo: currentSettings.elo,
            humanizer: currentSettings.humanizer,
            moveDelay: currentSettings.moveDelay,
            showSuggestions: currentSettings.showSuggestions,
            paused: currentSettings.paused
        });
    },

    renderCheckBoard(fen) {
        const container = document.getElementById('board-check-container');
        const fenLabel = document.getElementById('check-fen');
        if (!container || !fenLabel) return;
        fenLabel.textContent = fen;

        const rows = fen.split(' ')[0].split('/');
        const pieceMap = {
            'K': '♔', 'Q': '♕', 'R': '♖', 'B': '♗', 'N': '♘', 'P': '♙',
            'k': '♚', 'q': '♛', 'r': '♜', 'b': '♝', 'n': '♞', 'p': '♟'
        };

        const cells = [];
        rows.forEach((row, rowIndex) => {
            for (const char of row) {
                if (/[1-8]/.test(char)) {
                    for (let i = 0; i < parseInt(char, 10); i++) {
                        cells.push('');
                    }
                } else {
                    cells.push(pieceMap[char] || '');
                }
            }
        });

        const html = cells.map((piece, index) => {
            const rank = Math.floor(index / 8);
            const file = index % 8;
            const light = ((rank + file) % 2 !== 0) ? 'light' : 'dark';
            return `<div class="board-square ${light}"><span>${piece}</span></div>`;
        }).join('');

        container.innerHTML = `<div class="board-grid">${html}</div>`;
    },

    updateCheckSummary({ bestMove, evalScore, note }) {
        const best = document.getElementById('check-bestmove');
        const score = document.getElementById('check-eval');
        const noteEl = document.getElementById('check-note');
        if (best && bestMove !== undefined) best.innerText = bestMove;
        if (score && evalScore !== undefined) score.innerText = evalScore;
        if (noteEl && note !== undefined) noteEl.innerText = note;
    },

    renderCurrentBoard(fen) {
        const container = document.getElementById('current-board-container');
        const fenLabel = document.getElementById('current-fen');
        const turnLabel = document.getElementById('current-turn');
        if (!container || !fenLabel || !turnLabel) return;
        fenLabel.textContent = fen;
        const turn = fen.split(' ')[1] === 'w' ? 'White' : 'Black';
        turnLabel.textContent = turn;

        const rows = fen.split(' ')[0].split('/');
        const pieceMap = {
            'K': '♔', 'Q': '♕', 'R': '♖', 'B': '♗', 'N': '♘', 'P': '♙',
            'k': '♚', 'q': '♛', 'r': '♜', 'b': '♝', 'n': '♞', 'p': '♟'
        };

        const cells = [];
        rows.forEach((row, rowIndex) => {
            for (const char of row) {
                if (/[1-8]/.test(char)) {
                    for (let i = 0; i < parseInt(char, 10); i++) {
                        cells.push('');
                    }
                } else {
                    cells.push(pieceMap[char] || '');
                }
            }
        });

        const html = cells.map((piece, index) => {
            const rank = Math.floor(index / 8);
            const file = index % 8;
            const light = ((rank + file) % 2 !== 0) ? 'light' : 'dark';
            return `<div class="board-square ${light}"><span>${piece}</span></div>`;
        }).join('');

        container.innerHTML = `<div class="board-grid">${html}</div>`;
    },

    activateTab(tabName) {
        const buttons = document.querySelectorAll('.tab-btn');
        const panels = document.querySelectorAll('.tab-content');
        buttons.forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tabName));
        panels.forEach(panel => panel.classList.toggle('active', panel.id === `${tabName}-tab`));
    },

    setCheckBoardStatus(text) {
        const el = document.getElementById('bot-status');
        if (!el) return;
        el.innerText = text;
    },

    detectPlayerColor() {
        // [FIX 2026-06-29] Delegate to content.js detectPlayerColor() which uses
        // multi-method detection (flipped class, DOM attributes, piece position, URL)
        // so it correctly detects Black even in bot games where the board isn't flipped.
        const attempt = () => {
            if (typeof detectPlayerColor === 'function') {
                const color = detectPlayerColor();
                if (color) {
                    this.updatePlayerColor(color);
                    return true;
                }
            }
            // Fallback: check 'flipped' class directly
            const board = document.querySelector('wc-chess-board');
            if (!board) return false;
            this.updatePlayerColor(board.classList.contains('flipped') ? 'black' : 'white');
            return true;
        };
        if (!attempt()) {
            const iv = setInterval(() => { if (attempt()) clearInterval(iv); }, 900);
            setTimeout(() => clearInterval(iv), 30000);
        }
    },

    updateEval(score) {
        const el = document.getElementById('eval-display');
        if (!el) return;
        el.classList.remove('positive','negative','mate');
        if (typeof score === 'number') {
            el.innerText = (score > 0 ? '+' : '') + score.toFixed(1);
            el.classList.add(score >= 0 ? 'positive' : 'negative');
        } else {
            el.innerText = score;
            if (String(score).startsWith('M')) el.classList.add('mate');
        }
    },

    updateStatus(text) {
        const el = document.getElementById('bot-status');
        if (!el) return;
        el.innerText = text;
        el.classList.toggle('thinking', text.includes('Thinking') || text.includes('Analyzing') || text.includes('…'));
    },

    updatePlayerColor(color) {
        this.playerColor = color;
        const icon  = document.getElementById('color-icon');
        const label = document.getElementById('color-label');
        if (icon)  { icon.classList.remove('white-piece','black-piece'); icon.classList.add(`${color}-piece`); }
        if (label) label.textContent = color[0].toUpperCase() + color.slice(1);
    },

    updateEngineStatus(source) {
        const el = document.getElementById('engine-status');
        if (!el) return;
        const dot = el.querySelector('.status-dot');
        el.innerHTML = `<span class="status-dot"></span>${source}`;
    },

    // ── Drag ────────────────────────────────────────────────────────────────
    makeDraggable(el) {
        let ox = 0, oy = 0, sx = 0, sy = 0;
        el.onmousedown = (e) => {
            const t = e.target;
            if (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'BUTTON'
                || t.tagName === 'CANVAS' || t.id === 'resize-handle') return;
            e.preventDefault();
            sx = e.clientX; sy = e.clientY;
            document.onmousemove = (ev) => {
                ox = sx - ev.clientX; oy = sy - ev.clientY;
                sx = ev.clientX;      sy = ev.clientY;
                el.style.top  = (el.offsetTop  - oy) + 'px';
                el.style.left = (el.offsetLeft - ox) + 'px';
                el.style.right = 'auto';
            };
            document.onmouseup = () => {
                document.onmousemove = null;
                document.onmouseup   = null;
            };
        };
    },

    // ── Resize ──────────────────────────────────────────────────────────────
    makeResizable(el) {
        const handle = document.getElementById('resize-handle');
        if (!handle) return;
        let sx, sy, sw, sh;
        handle.addEventListener('mousedown', (e) => {
            e.preventDefault(); e.stopPropagation();
            sx = e.clientX; sy = e.clientY;
            sw = el.offsetWidth; sh = el.offsetHeight;
            const mv = (ev) => {
                el.style.width  = Math.max(260, sw + ev.clientX - sx) + 'px';
                el.style.height = Math.max(300, sh + ev.clientY - sy) + 'px';
            };
            const up = () => {
                document.removeEventListener('mousemove', mv);
                document.removeEventListener('mouseup',   up);
            };
            document.addEventListener('mousemove', mv);
            document.addEventListener('mouseup',   up);
        });
    }
};
