type MessageCallback = (data: any) => void;

class WebSocketClient {
  private socket: WebSocket | null = null;
  private listeners: Set<MessageCallback> = new Set();
  private statusListeners: Set<(open: boolean) => void> = new Set();
  private reconnectTimeout: number | null = null;
  private isConnecting: boolean = false;
  private url: string;

  constructor() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    this.url = `${protocol}//${host}/ws`;
  }

  public connect() {
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.isConnecting = true;
    try {
      this.socket = new WebSocket(this.url);

      this.socket.onopen = () => {
        this.isConnecting = false;
        this.statusListeners.forEach((cb) => cb(true));
      };

      this.socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.listeners.forEach((callback) => callback(data));
        } catch (e) {
          console.warn('[WS] Error parseando mensaje JSON:', e);
        }
      };

      this.socket.onclose = () => {
        this.isConnecting = false;
        this.statusListeners.forEach((cb) => cb(false));
        this.scheduleReconnect();
      };

      this.socket.onerror = (err) => {
        console.warn('[WS] Error de conexión:', err);
        this.socket?.close();
      };
    } catch (e) {
      this.isConnecting = false;
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimeout) return;
    this.reconnectTimeout = window.setTimeout(() => {
      this.reconnectTimeout = null;
      this.connect();
    }, 2500);
  }

  public subscribe(callback: MessageCallback): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  /** Avisa cada vez que la conexión se abre o se cae. */
  public onStatus(cb: (open: boolean) => void): () => void {
    this.statusListeners.add(cb);
    cb(this.socket?.readyState === WebSocket.OPEN);
    return () => {
      this.statusListeners.delete(cb);
    };
  }

  public send(data: any) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(typeof data === 'string' ? data : JSON.stringify(data));
    }
  }
}

export const wsClient = new WebSocketClient();
