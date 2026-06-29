"""
mouse_server.py — ChessBot Native Click Server v2.0
====================================================
Implements the "Click-Click" strategy for reliable piece movement.
Instead of dragging (which is prone to OS micro-stutters dropping pieces),
we do two discrete clicks: select the piece, then click the destination.

HOW TO RUN:
    pip install flask flask-cors pyautogui
    python mouse_server.py

EMERGENCY STOP:
    1. Move your mouse to the TOP-LEFT corner of your screen (pyautogui failsafe)
    2. OR press Ctrl+C in this terminal
    3. OR send POST to http://localhost:5050/stop
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
import pyautogui
import threading
import time
import random
import sys

# ── App Setup ──────────────────────────────────────────────────────────────────
app = Flask(__name__)
CORS(app)  # Allow the Chrome extension to make requests

# ── Safety Configuration ───────────────────────────────────────────────────────
pyautogui.FAILSAFE = True   # Move mouse to TOP-LEFT corner to abort immediately
pyautogui.PAUSE = 0.0       # We control our own delays — don't add pyautogui's default pause

# ── Global Stop Flag ──────────────────────────────────────────────────────────
# Set this to True via the /stop endpoint or Ctrl+C to abort any in-progress click
_stop_flag = threading.Event()
_action_lock = threading.Lock()  # Prevents two moves from being executed simultaneously


def is_stopped() -> bool:
    """Check if an emergency stop has been requested."""
    return _stop_flag.is_set()


def safe_sleep(duration: float) -> bool:
    """
    Sleep for `duration` seconds, but wake up immediately if stop is requested.
    Returns True if we slept fully, False if we were interrupted.
    """
    interrupted = _stop_flag.wait(timeout=duration)
    return not interrupted  # wait() returns True if the event was SET (i.e., stop was called)


def validate_coordinates(data: dict) -> tuple[bool, str]:
    """Validate that all required coordinate fields are present and numeric."""
    required_fields = ['x1', 'y1', 'x2', 'y2', 'screenX', 'screenY', 'outerHeight', 'innerHeight']
    for field in required_fields:
        if field not in data:
            return False, f"Missing required field: '{field}'"
        if not isinstance(data[field], (int, float)):
            return False, f"Field '{field}' must be a number, got: {type(data[field]).__name__}"
    return True, ""


def calculate_absolute_coords(data: dict) -> tuple[int, int, int, int]:
    """
    Convert chess.com board-relative coordinates to absolute screen coordinates.
    
    Chess.com gives us coordinates relative to the browser viewport (inner window).
    We need to add the browser chrome offset (tabs, address bar, etc.) and the
    window's position on the physical screen.
    
    Formula:
        abs_x = window.screenX + viewport_x
        abs_y = window.screenY + (outerHeight - innerHeight) + viewport_y
                                  └─ browser chrome height ─┘
    """
    y_chrome_offset = data['outerHeight'] - data['innerHeight']

    abs_x1 = int(data['screenX'] + data['x1'])
    abs_y1 = int(data['screenY'] + y_chrome_offset + data['y1'])
    abs_x2 = int(data['screenX'] + data['x2'])
    abs_y2 = int(data['screenY'] + y_chrome_offset + data['y2'])

    return abs_x1, abs_y1, abs_x2, abs_y2


# ── Click-Click Move (Primary Strategy) ───────────────────────────────────────
def perform_click_click(abs_x1: int, abs_y1: int, abs_x2: int, abs_y2: int) -> dict:
    """
    Execute a two-click move sequence:
      1. Move to the piece's square and click (selects/highlights it)
      2. Move to the destination square and click (drops/moves the piece)

    Human-like randomness is injected into durations and inter-click delays
    to avoid Chess.com's bot detection heuristics.

    Returns a result dict with success status and any error message.
    """
    try:
        # ── Step 1: Move to source square and click ──
        if is_stopped():
            return {"success": False, "error": "Stopped before move 1"}

        move_duration_1 = 0.12 + random.uniform(0.04, 0.12)  # 160–240ms
        pyautogui.moveTo(abs_x1, abs_y1, duration=move_duration_1)

        if is_stopped():
            return {"success": False, "error": "Stopped before click 1"}

        pyautogui.click()
        print(f"  [Click 1] Piece selected at ({abs_x1}, {abs_y1})")

        # ── Wait for piece highlight to register ──
        # Chess.com needs a brief moment after selection before accepting the 2nd click.
        # Too short = the board ignores click 2. Too long = looks robotic.
        highlight_wait = random.uniform(0.08, 0.18)
        if not safe_sleep(highlight_wait):
            return {"success": False, "error": "Stopped during highlight wait"}

        # ── Step 2: Move to destination square and click ──
        move_duration_2 = 0.15 + random.uniform(0.06, 0.14)  # 210–290ms
        pyautogui.moveTo(abs_x2, abs_y2, duration=move_duration_2)

        if is_stopped():
            return {"success": False, "error": "Stopped before click 2"}

        pyautogui.click()
        print(f"  [Click 2] Piece dropped at  ({abs_x2}, {abs_y2})")

        # ── Brief post-move pause (lets Chess.com register and animate) ──
        post_move_wait = random.uniform(0.04, 0.10)
        safe_sleep(post_move_wait)

        return {"success": True}

    except pyautogui.FailSafeException:
        print("[EMERGENCY STOP] Mouse reached top-left corner — FailSafe triggered!")
        _stop_flag.set()
        return {"success": False, "error": "FailSafe triggered — mouse moved to corner"}

    except Exception as e:
        print(f"[ERROR] Click-click failed: {e}")
        return {"success": False, "error": str(e)}


def perform_click_click_fast(abs_x1: int, abs_y1: int, abs_x2: int, abs_y2: int) -> dict:
    """
    Ultra-fast click-click move for bullet games. Durations are minimized
    but still keep tiny randomness to avoid exact repeatability.
    This is riskier but much faster than the standard routine.
    """
    try:
        if is_stopped():
            return {"success": False, "error": "Stopped before move 1"}

        # Very short move durations — 20–60ms
        move_duration_1 = 0.03 + random.uniform(0.0, 0.03)
        pyautogui.moveTo(abs_x1, abs_y1, duration=move_duration_1)

        if is_stopped():
            return {"success": False, "error": "Stopped before click 1"}

        pyautogui.click()

        # Minimal highlight wait — 10–30ms
        highlight_wait = random.uniform(0.01, 0.03)
        if not safe_sleep(highlight_wait):
            return {"success": False, "error": "Stopped during highlight wait"}

        move_duration_2 = 0.03 + random.uniform(0.0, 0.04)
        pyautogui.moveTo(abs_x2, abs_y2, duration=move_duration_2)

        if is_stopped():
            return {"success": False, "error": "Stopped before click 2"}

        pyautogui.click()

        # Tiny post-move pause
        post_move_wait = random.uniform(0.005, 0.02)
        safe_sleep(post_move_wait)

        return {"success": True}

    except pyautogui.FailSafeException:
        print("[EMERGENCY STOP] Mouse reached top-left corner — FailSafe triggered!")
        _stop_flag.set()
        return {"success": False, "error": "FailSafe triggered — mouse moved to corner"}

    except Exception as e:
        print(f"[ERROR] Fast Click-click failed: {e}")
        return {"success": False, "error": str(e)}


# ── Legacy Drag Move (Fallback) ────────────────────────────────────────────────
def perform_drag(abs_x1: int, abs_y1: int, abs_x2: int, abs_y2: int) -> dict:
    """
    Legacy drag-and-drop strategy (kept as fallback).
    Less reliable than click-click due to OS micro-stutters causing premature drops.
    Use /drag endpoint to access this.
    """
    try:
        if is_stopped():
            return {"success": False, "error": "Stopped before drag"}

        pyautogui.moveTo(abs_x1, abs_y1, duration=0.1 + random.uniform(0.05, 0.15))
        pyautogui.mouseDown(button='left')
        safe_sleep(random.uniform(0.03, 0.08))

        if is_stopped():
            pyautogui.mouseUp(button='left')  # Always release the mouse on abort!
            return {"success": False, "error": "Stopped mid-drag — mouse released safely"}

        pyautogui.moveTo(abs_x2, abs_y2, duration=0.2 + random.uniform(0.1, 0.2))
        safe_sleep(random.uniform(0.03, 0.08))
        pyautogui.mouseUp(button='left')

        return {"success": True}

    except pyautogui.FailSafeException:
        try:
            pyautogui.mouseUp(button='left')  # Release mouse even on failsafe
        except Exception:
            pass
        _stop_flag.set()
        return {"success": False, "error": "FailSafe triggered during drag"}

    except Exception as e:
        try:
            pyautogui.mouseUp(button='left')
        except Exception:
            pass
        return {"success": False, "error": str(e)}


# ── Flask Routes ───────────────────────────────────────────────────────────────

@app.route('/click', methods=['POST'])
def click_piece():
    """
    PRIMARY ENDPOINT — Click-Click Strategy
    
    Expected JSON payload (same as /drag — no changes to automation.js needed):
    {
        "x1": 320,        // Source square X (viewport-relative)
        "y1": 480,        // Source square Y (viewport-relative)
        "x2": 480,        // Destination square X (viewport-relative)
        "y2": 320,        // Destination square Y (viewport-relative)
        "screenX": 0,     // window.screenX (browser window left edge on screen)
        "screenY": 0,     // window.screenY (browser window top edge on screen)
        "outerHeight": 900, // window.outerHeight (full window height inc. chrome)
        "innerHeight": 860  // window.innerHeight (viewport height only)
    }
    """
    # Reject if already performing a move
    if not _action_lock.acquire(blocking=False):
        return jsonify({"success": False, "error": "Move already in progress — try again"}), 429

    try:
        # Clear stop flag at the start of a new move (allow retry after stop)
        _stop_flag.clear()

        data = request.json
        if not data:
            return jsonify({"success": False, "error": "No JSON body received"}), 400

        valid, err = validate_coordinates(data)
        if not valid:
            return jsonify({"success": False, "error": err}), 400

        abs_x1, abs_y1, abs_x2, abs_y2 = calculate_absolute_coords(data)

        print(f"\n[Move] Click-Click: ({abs_x1},{abs_y1}) → ({abs_x2},{abs_y2})")
        result = perform_click_click(abs_x1, abs_y1, abs_x2, abs_y2)

        status_code = 200 if result["success"] else 500
        return jsonify(result), status_code

    finally:
        _action_lock.release()


@app.route('/drag', methods=['POST'])
def drag_piece():
    """
    LEGACY ENDPOINT — Drag Strategy (kept for fallback/comparison)
    Same payload format as /click.
    """
    if not _action_lock.acquire(blocking=False):
        return jsonify({"success": False, "error": "Move already in progress — try again"}), 429

    try:
        _stop_flag.clear()

        data = request.json
        if not data:
            return jsonify({"success": False, "error": "No JSON body received"}), 400

        valid, err = validate_coordinates(data)
        if not valid:
            return jsonify({"success": False, "error": err}), 400

        abs_x1, abs_y1, abs_x2, abs_y2 = calculate_absolute_coords(data)

        print(f"\n[Move] Drag: ({abs_x1},{abs_y1}) → ({abs_x2},{abs_y2})")
        result = perform_drag(abs_x1, abs_y1, abs_x2, abs_y2)

        status_code = 200 if result["success"] else 500
        return jsonify(result), status_code

    finally:
        _action_lock.release()


@app.route('/click_fast', methods=['POST'])
def click_piece_fast():
    """
    FAST ENDPOINT — Ultra-fast Click-Click for bullet play.
    Same payload as /click but uses `perform_click_click_fast`.
    """
    if not _action_lock.acquire(blocking=False):
        return jsonify({"success": False, "error": "Move already in progress — try again"}), 429

    try:
        _stop_flag.clear()

        data = request.json
        if not data:
            return jsonify({"success": False, "error": "No JSON body received"}), 400

        valid, err = validate_coordinates(data)
        if not valid:
            return jsonify({"success": False, "error": err}), 400

        abs_x1, abs_y1, abs_x2, abs_y2 = calculate_absolute_coords(data)

        print(f"\n[Move] FAST Click-Click: ({abs_x1},{abs_y1}) → ({abs_x2},{abs_y2})")
        result = perform_click_click_fast(abs_x1, abs_y1, abs_x2, abs_y2)

        status_code = 200 if result["success"] else 500
        return jsonify(result), status_code

    finally:
        _action_lock.release()


@app.route('/stop', methods=['POST'])
def emergency_stop():
    """
    EMERGENCY STOP ENDPOINT
    Immediately signals any in-progress click/drag sequence to abort.
    Send a POST to http://localhost:5050/stop from any tool/browser tab.
    """
    _stop_flag.set()
    print("\n[EMERGENCY STOP] Stop signal received via /stop endpoint!")
    return jsonify({"success": True, "message": "Stop signal sent"})


@app.route('/status', methods=['GET'])
def status():
    """Health-check endpoint. Useful for confirming the server is alive."""
    return jsonify({
        "running": True,
        "stopped": is_stopped(),
        "busy": _action_lock.locked(),
        "version": "2.0",
        "endpoints": {
            "POST /click": "Click-click move (primary — recommended)",
            "POST /drag":  "Drag-and-drop move (legacy fallback)",
            "POST /stop":  "Emergency stop any in-progress move",
            "GET  /status": "This status page"
        }
    })


# ── Entry Point ────────────────────────────────────────────────────────────────
if __name__ == '__main__':
    print("=" * 60)
    print("  ChessBot Native Click Server v2.0")
    print("=" * 60)
    print("  Listening on: http://localhost:5050")
    print()
    print("  Endpoints:")
    print("    POST /click  — Click-click move (PRIMARY)")
    print("    POST /drag   — Drag move (legacy fallback)")
    print("    POST /stop   — Emergency stop")
    print("    GET  /status — Health check")
    print()
    print("  EMERGENCY STOPS:")
    print("    1. Move mouse to TOP-LEFT corner of screen")
    print("    2. Press Ctrl+C in this terminal")
    print("    3. POST to http://localhost:5050/stop")
    print()
    print("  Make sure Chess.com is VISIBLE and FOCUSED!")
    print("=" * 60)

    try:
        # use_reloader=False is important — reloader spawns a child process
        # which breaks pyautogui's access to the display on some systems.
        app.run(port=5050, use_reloader=False, threaded=True)
    except KeyboardInterrupt:
        print("\n[Shutdown] Server stopped by user (Ctrl+C).")
        sys.exit(0)
