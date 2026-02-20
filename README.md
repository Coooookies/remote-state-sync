# Remote State Sync

A lightweight, fully type-safe unidirectional remote state synchronization library. Effortlessly sync complex states with fine-grained precision from a Provider (e.g., Server or Electron Main) to a Receiver (e.g., Web Client or Electron Renderer).

English | [中文](./README.zh-CN.md)

## Features

- **Unidirectional Sync**: Safely sync state from A to B with an efficient patch-based diffing system.
- **Deep Reactivity & Proxies**: Built-in, automatic support for intercepting deep changes across `Object`, `Map`, and `Set` structures.
- **Batch Patching**: Automatically queues and batches rapid state mutations into singular, optimized events for high performance.
- **Framework Agnostic Transport**: Bring your own transport layer (WebSocket, Socket.io, Electron IPC, HTTP, etc).
- **Vue Integration**: Seamlessly connects to Vue's Reactivity system out of the box (`toValue()`, `toRef()`, `toShallowRef()`).

## Installation

```bash
npm install remote-state-sync
```

## Examples

### 1. Hono + Socket.IO (Server & Client Web)

**Server (Provider)**

```typescript
import { SyncProvider } from 'remote-state-sync';
import { Hono } from 'hono';
import { Server } from 'socket.io';

const app = new Hono();
const io = new Server(3000);

const provider = new SyncProvider();
const usersNs = provider.register('users_space');

// Define a state
type UserState = {
  connected: number;
  history: string[];
};

// Initialize the state
const userState = usersNs.sync<UserState>('data', {
  connected: 0,
  history: [],
});

// 1. snapshotGetter implementation via HTTP endpoint
app.get('/snapshot/:namespace', (c) => {
  const ns = c.req.param('namespace');
  return c.json(provider.getStateSnapshot(ns));
});

io.on('connection', (socket) => {
  // Mutating deeply tracks changes and queues patches automatically
  userState.set((state) => void state.connected++);

  socket.on('disconnect', () => {
    userState.set((state) => void state.connected--);
  });
});

// 2. Broadcast patches triggered by deeper modifications over WebSocket
provider.bus.on('update', (namespace, patches) => {
  io.emit('state-update', namespace, patches);
});
```

**Client (Receiver)**

```typescript
import { SyncReceiver } from 'remote-state-sync';
import { io } from 'socket.io-client';

const socket = io('ws://localhost:3000');

const receiver = new SyncReceiver({
  // 1. Fetch the initial snapshot over HTTP
  snapshotGetter: async (namespace) => {
    const res = await fetch(`http://localhost:3000/snapshot/${namespace}`);
    return res.json();
  },
});

// 2. Receive and apply patches incrementally
socket.on('state-update', (namespace, patches) => {
  receiver.applyPatches(namespace, patches);
});

async function main() {
  const usersNs = await receiver.register('users_space');

  type UserState = { connected: number; history: string[] };
  const userState = usersNs.sync<UserState>('data');

  // Output: { connected: 1, history: [] }
  console.log(userState.toValue());

  // Listen to specific item changes!
  userState.on('update', (newVal, oldVal, patches) => {
    console.log('State updated!', newVal.connected);
  });
}
main();
```

### 2. Electron (`ipcMain` + `ipcRenderer`)

**Main Process (Provider)**

```typescript
import { SyncProvider } from 'remote-state-sync';
import { ipcMain, BrowserWindow } from 'electron';

const provider = new SyncProvider();
const appNs = provider.register('app_ns');

type SettingsState = {
  theme: 'dark' | 'light';
  version: string;
};

// Initialize the state
const settings = appNs.sync<SettingsState>('settings', {
  theme: 'dark',
  version: '1.0.0',
});

// 1. snapshotGetter via ipcMain.handle
ipcMain.handle('get-sync-snapshot', (_, namespace) => {
  return provider.getStateSnapshot(namespace);
});

// 2. Broadcast patches to all renderer windows
provider.bus.on('update', (namespace, patches) => {
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send('sync-update', namespace, patches);
  });
});

// Example modification later down the line
setTimeout(() => {
  settings.set((state) => void (state.theme = 'light'));
}, 5000);
```

**Renderer Process (Receiver with Vue)**

```typescript
import { SyncReceiver } from 'remote-state-sync';
import { ipcRenderer } from 'electron';
import { watch } from 'vue';

const receiver = new SyncReceiver({
  // 1. Fetch the snapshot via ipcRenderer.invoke
  snapshotGetter: (namespace) => ipcRenderer.invoke('get-sync-snapshot', namespace),
});

// 2. Listen for patches from Main process
ipcRenderer.on('sync-update', (_, namespace, patches) => {
  receiver.applyPatches(namespace, patches);
});

async function setup() {
  const appNs = await receiver.register('app_ns');
  const settings = appNs.sync<SettingsState>('settings');

  // Vue Reactivity directly tied to the remote state!
  const settingsRef = settings.toRef();

  watch(
    settingsRef,
    (newSettings) => {
      console.log('Renderer theme changed to:', newSettings.theme);
    },
    { deep: true },
  );
}
setup();
```
