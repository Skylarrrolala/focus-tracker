const { app, BrowserWindow, shell, Menu } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');

// Fixed port so Google OAuth and Supabase redirect URLs stay stable across launches.
// If you change this, update the "Authorized JavaScript origins" in Google Cloud
// and the Redirect URL in Supabase to match (http://localhost:PORT).
const PORT = 51739;
const APP_DIR = path.join(__dirname, 'app-files');

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png'
};

function startServer(){
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = req.url.split('?')[0];
      const filePath = path.join(APP_DIR, urlPath === '/' ? 'index.html' : urlPath);
      const ext = path.extname(filePath);
      fs.readFile(filePath, (err, data) => {
        if(err){
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Not found');
          return;
        }
        res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.listen(PORT, '127.0.0.1', resolve);
  });
}

let mainWindow;

async function createWindow(){
  await startServer();

  mainWindow = new BrowserWindow({
    width: 920,
    height: 820,
    minWidth: 480,
    minHeight: 600,
    title: 'Focus.',
    backgroundColor: '#FAFAF8',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadURL(`http://localhost:${PORT}/index.html`);

  // Links like "Join call" or anything opening in a new tab should open in the
  // system browser, not inside the app window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

// Minimal native menu (gives you Cmd+Q, Cmd+W, copy/paste, etc.)
function buildMenu(){
  const template = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }
      ]
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'close' }, { role: 'zoom' }]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  buildMenu();
  createWindow();
});

app.on('window-all-closed', () => {
  if(process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if(BrowserWindow.getAllWindows().length === 0) createWindow();
});
