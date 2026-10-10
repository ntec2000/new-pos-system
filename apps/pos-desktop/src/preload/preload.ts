import { contextBridge, ipcRenderer } from 'electron';
import type { PosBridge } from '../shared/bridge';

const bridge: PosBridge = {
  call: (method, ...args) => ipcRenderer.invoke('repo:call', method, args),
  print: payload => ipcRenderer.invoke('printer:print', payload),
  listPrinters: () => ipcRenderer.invoke('printer:list'),
  sendRaw: payload => ipcRenderer.invoke('printer:raw', payload),
  info: () => ipcRenderer.invoke('app:info'),
};

contextBridge.exposeInMainWorld('pos', bridge);
