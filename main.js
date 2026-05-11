const {
  app,
  BrowserWindow,
  shell,
  session,
  desktopCapturer,
  Menu,
  Tray,
  powerMonitor,
} = require("electron");
const path = require("path");

const URL_V2 = "https://app.v2.gather.town/";
const URL_CLASSIC = "https://app.gather.town/";

// Determine URL based on startup flags
let GATHER_URL = process.argv.includes("--classic") ? URL_CLASSIC : URL_V2;

// --v2-space <value> appends /app/<value> to the V2 URL
const spaceIdx = process.argv.indexOf("--v2-space");
if (spaceIdx !== -1 && spaceIdx + 1 < process.argv.length) {
  const space = process.argv[spaceIdx + 1];
  GATHER_URL = URL_V2 + "app/" + space;
}

// DISABLE THE NATIVE MENU
Menu.setApplicationMenu(null);

let tray = null;
let mainWindow = null;
let isQuitting = false;

function createTray() {
  // Resolve the icon path relative to the app directory
  const iconPath = path.join(__dirname, "assets", "icon.png");
  tray = new Tray(iconPath);
  tray.setToolTip("Gather");

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Show/Hide",
      click: () => {
        if (mainWindow) {
          if (mainWindow.isVisible()) {
            mainWindow.hide();
          } else {
            mainWindow.show();
            mainWindow.focus();
          }
        }
      },
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  // Left-click on tray icon toggles window visibility
  tray.on("click", () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });
}

function createWindow() {
  const iconPath = path.join(__dirname, "assets", "icon.png");
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: "Gather",
    icon: iconPath,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  mainWindow = win;

  // Hide to tray instead of closing
  win.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      win.hide();
    }
  });

  win.loadURL(GATHER_URL, {
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });

  // --- AUTO-CLICK JOIN BUTTON ---
  win.webContents.on("did-finish-load", () => {
    win.webContents
      .executeJavaScript(
        `
      (function() {
        let attempts = 0;
        const maxAttempts = 50; // Poll for up to ~10 seconds
        const interval = setInterval(() => {
          attempts++;
          const buttons = Array.from(document.querySelectorAll('button'));
          const joinBtn = buttons.find(b => b.textContent && b.textContent.trim() === 'Join');
          if (joinBtn) {
            joinBtn.click();
            console.log("Auto-clicked Join button");
            clearInterval(interval);
          } else if (attempts >= maxAttempts) {
            clearInterval(interval);
          }
        }, 200);
      })();
      `,
      )
      .catch((err) => console.log("Auto-Join Error:", err));
  });
  // ------------------------------

  // --- AUTO AWAY ON SUSPEND ---
  powerMonitor.on("suspend", () => {
    console.log("System suspending...");
    win.webContents
      .executeJavaScript(
        `
      (function() {
        const container = document.getElementById('av-toolbar-pip-container');
        if (container) {
          const avatarBtn = container.querySelector('button');
          if (avatarBtn) {
            avatarBtn.click(); // 1. Open Menu
            setTimeout(() => {
              const allButtons = Array.from(document.querySelectorAll('button'));
              const awayBtn = allButtons.find(b => b.textContent && b.textContent.trim() === 'Away');
              if (awayBtn) {
                awayBtn.click(); // 2. Click Away
                console.log("Set status to Away");
              }
            }, 100);
          }
        }
      })();
    `,
      )
      .catch((err) => console.log("Auto-Away Error:", err));
  });
  // ----------------------------

  session.defaultSession.setPermissionRequestHandler(
    (webContents, permission, callback) => {
      const allowedPermissions = [
        "media",
        "accessibility-events",
        "display-capture",
      ];
      if (allowedPermissions.includes(permission)) {
        callback(true);
      } else {
        callback(false);
      }
    },
  );

  session.defaultSession.setDisplayMediaRequestHandler(
    (request, callback) => {
      desktopCapturer
        .getSources({ types: ["screen", "window"] })
        .then((sources) => {
          if (sources.length === 1) {
            callback({ video: sources[0] });
            return;
          }
          const menu = Menu.buildFromTemplate(
            sources.map((source) => {
              return {
                label: source.name,
                click: () => {
                  // Video only (Audio must be excluded to prevent crash)
                  callback({ video: source });
                },
              };
            }),
          );
          menu.popup();
        })
        .catch((err) => console.log("Screen share error:", err));
    },
    {
      useSystemPicker: true,
    },
  );

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (
      url.startsWith("https://gather.town") ||
      url.includes("accounts.google.com")
    ) {
      return { action: "allow" };
    }
    if (url.startsWith("https://") || url.startsWith("http://")) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });
}

app.whenReady().then(() => {
  createTray();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
});

// Allow quit when isQuitting is set (via tray menu)
app.on("before-quit", () => {
  isQuitting = true;
});

app.on("window-all-closed", () => {
  // On Linux/Windows, don't quit — the tray keeps the app alive.
  // On macOS, this is already the default behavior.
  if (process.platform === "darwin") {
    // macOS: standard behavior, app stays in dock
  }
  // Otherwise: do nothing, tray icon keeps the app running
});
