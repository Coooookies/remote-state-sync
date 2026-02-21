# Remote State Sync

轻量级、完全类型安全的单向远程状态同步库。轻松将复杂状态以细小粒度从 Provider（如：服务端 Server 或 Electron 主进程）同步到 Receiver（如：Web 客户端 Client 或 Electron 渲染进程）。

[English](./README.md) | 中文

## 特性

- **单向同步**：通过高效的增量 Patch (补丁) 算法，将状态从 A 端安全地同步到 B 端。
- **深度响应与代理拦截**：内建支持对 `Object`、`Map` 和 `Set` 数据类型结构进行深层侦听、拦截与同步同步。
- **补丁按需批处理**：高频次、连续的状态变更会在底层自动批量打包合并为单次事件分发，最大化性能。
- **多端传输解耦**：不强绑定任何传输协议。可以灵活适配 WebSocket、Socket.io、Electron IPC、HTTP 等任意传输层网络！
- **完美兼容 Vue**：提供无缝的 `@vue/reactivity` 支持能力，开箱即用（支持 `.toValue()`、`.toRef()` 和 `.toShallowRef()`）。

## 安装

```bash
npm install remote-state-sync
```

## 场景示例

### 1. 组合：Hono + Socket.IO (Server端与Web端通信)

**服务端 Server (提供方 Provider)**

```typescript
import { SyncProvider } from 'remote-state-sync';
import { Hono } from 'hono';
import { Server } from 'socket.io';

const app = new Hono();
const io = new Server(3000);

const provider = new SyncProvider();
const usersNs = provider.register('users_space');

// 定义一个状态
type UserState = {
  connected: number;
  history: string[];
};

// 初始化这个状态
const userState = usersNs.sync<UserState>('data', {
  connected: 0,
  history: [],
});

// 第一步：利用 Hono 提供 HTTP 接口
// 向客户端暴露 Snapshot
app.get('/snapshot/:namespace/:key', (c) => {
  const ns = c.req.param('namespace');
  const key = c.req.param('key');
  return c.json(provider.getStateSnapshot(ns, key));
});

io.on('connection', (socket) => {
  // 修改复杂对象会自动生成补丁（得益于内部 Proxy）
  userState.set((state) => void state.connected++);

  socket.on('disconnect', () => {
    userState.set((state) => void state.connected--);
  });
});

// 第二步：通过 WebSocket 向外部广播由于变更生成的批量 Patches
provider.bus.on('update', (namespace, patches) => {
  io.emit('state-update', namespace, patches);
});
```

**Web客户端 Client (接收方 Receiver)**

```typescript
import { SyncReceiver } from 'remote-state-sync';
import { io } from 'socket.io-client';

const socket = io('ws://localhost:3000');

const receiver = new SyncReceiver({
  // 第一步：通过 HTTP 拉取远端快照，作为初始化状态
  snapshotGetter: async (namespace, key) => {
    const res = await fetch(`http://localhost:3000/snapshot/${namespace}/${key}`);
    return res.json();
  },
});

// 第二步：接管增量 Patches，增量更新本地状态树
socket.on('state-update', (namespace, patches) => {
  receiver.applyPatches(namespace, patches);
});

async function main() {
  const usersNs = await receiver.register('users_space');

  type UserState = { connected: number; history: string[] };
  const userState = await usersNs.sync<UserState>('data');

  // Output: { connected: 1, history: [] }
  console.log(userState.toValue());

  userState.on('update', (newVal, oldVal, patches) => {
    console.log('状态更新', newVal.connected);
  });
}
main();
```

### 2.组合：Electron (`ipcMain` + `ipcRenderer`)

**主进程 Main Process (提供方 Provider)**

```typescript
import { SyncProvider } from 'remote-state-sync';
import { ipcMain, BrowserWindow } from 'electron';

const provider = new SyncProvider();
const appNs = provider.register('app_ns');

type SettingsState = {
  theme: 'dark' | 'light';
  version: string;
};

// 初始化状态
const settings = appNs.sync<SettingsState>('settings', {
  theme: 'dark',
  version: '1.0.0',
});

// 第一步：通过 ipcMain.handle 暴露 snapshot 获取能力
ipcMain.handle('get-sync-snapshot', (_, namespace, key) => {
  return provider.getStateSnapshot(namespace, key);
});

// 第二步：将状态补丁通过 ipcEvent 主动投递给所有渲染进程
provider.bus.on('update', (namespace, patches) => {
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send('sync-update', namespace, patches);
  });
});

// 修改示例
setTimeout(() => {
  settings.set((state) => void (state.theme = 'light'));
}, 5000);
```

**渲染进程 Renderer Process (结合Vue使用的 Receiver)**

```typescript
import { SyncReceiver } from 'remote-state-sync';
import { ipcRenderer } from 'electron';
import { watch } from 'vue';

const receiver = new SyncReceiver({
  // 第一步：利用 ipcRenderer.invoke 异步请求 Snapshot
  snapshotGetter: (namespace, key) => ipcRenderer.invoke('get-sync-snapshot', namespace, key),
});

// 第二步：监听来自主进程投递的 Patches
ipcRenderer.on('sync-update', (_, namespace, patches) => {
  receiver.applyPatches(namespace, patches);
});

async function setup() {
  const appNs = await receiver.register('app_ns');
  const settings = await appNs.sync<SettingsState>('settings');

  // 第三步：将远端状态一键接入 Vue 的响应式生态内！
  const settingsRef = settings.toRef(); // 或 toShallowRef()

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
