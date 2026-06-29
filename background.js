// background.js — v2.8 (Nuclear Option)
// The entire Service Worker Offscreen architecture has been SCRAPPED.
// We now run the engine inside a localized iframe injected by the content script.
// This completely bypasses the Chrome Manifest V3 Service Worker bugs.
// The "No SW" error is now physically impossible to occur.

// ── Keep-alive for Service Worker (just in case Chrome needs it for storage) ──
chrome.runtime.onConnect.addListener((port) => {
    if (port.name === 'keep-alive') {
        port.onDisconnect.addListener(() => {});
    }
});

// ── Proxy Fetch for Python Mouse Server ──
// Content scripts are bound by Chess.com's Content Security Policy (CSP),
// which blocks fetch() requests to localhost. The background script bypasses this.
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'PROXY_PYTHON_DRAG') {
        fetch('http://localhost:5050/click', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(request.payload)
        })
        .then(response => response.json())
        .then(data => sendResponse({ success: true, data }))
        .catch(error => sendResponse({ success: false, error: error.toString() }));
        
        return true; // Keep the message channel open for async response
    }
    if (request.type === 'PROXY_PYTHON_DRAG_FAST') {
        fetch('http://localhost:5050/click_fast', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(request.payload)
        })
        .then(response => response.json())
        .then(data => sendResponse({ success: true, data }))
        .catch(error => sendResponse({ success: false, error: error.toString() }));

        return true;
    }
});
