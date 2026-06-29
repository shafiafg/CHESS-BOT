const ELO_CONFIG = {
    "400": { skill: 1, depth: 1, label: "Noob (400)" },
    "800": { skill: 3, depth: 3, label: "Beginner (800)" },
    "1200": { skill: 5, depth: 6, label: "Casual (1200)" },
    "1600": { skill: 7, depth: 9, label: "Intermediate (1600)" },
    "2000": { skill: 9, depth: 12, label: "Advanced (2000)" },
    "2400": { skill: 18, depth: 16, label: "Professional (2400)" },
    "2800": { skill: 20, depth: 20, label: "World Class (2800)" },
    "3000": { skill: 20, depth: 24, label: "Stockfish (3000)" }
};

let currentSettings = {
    elo: "3000",
    autoPlay: false, // Never persisted — always starts off
    showSuggestions: true,
    humanizer: true,
    bulletMode: false,
    moveDelay: 1000, // ms
    paused: false
};

// Load persisted settings (except autoPlay)
function loadSettings() {
    return new Promise((resolve) => {
        chrome.storage.local.get(['elo', 'humanizer', 'moveDelay', 'showSuggestions', 'paused', 'bulletMode'], (result) => {
            if (result.elo && ELO_CONFIG[result.elo]) currentSettings.elo = result.elo;
            if (result.humanizer !== undefined) currentSettings.humanizer = result.humanizer;
            if (result.moveDelay !== undefined) currentSettings.moveDelay = result.moveDelay;
            if (result.showSuggestions !== undefined) currentSettings.showSuggestions = result.showSuggestions;
            if (result.paused !== undefined) currentSettings.paused = result.paused;
                if (result.bulletMode !== undefined) currentSettings.bulletMode = result.bulletMode;
            // autoPlay is NEVER loaded — always starts false
            resolve();
        });
    });
}

// Save settings (excludes autoPlay)
function saveSettings() {
    chrome.storage.local.set({
        elo: currentSettings.elo,
        humanizer: currentSettings.humanizer,
        moveDelay: currentSettings.moveDelay,
        showSuggestions: currentSettings.showSuggestions,
        paused: currentSettings.paused,
        bulletMode: currentSettings.bulletMode
    });
}
