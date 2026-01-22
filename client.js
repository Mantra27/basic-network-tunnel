#!/usr/bin/env node

import net from 'net';
import http from 'http';
import { program } from 'commander';

class TunnelClient {
  constructor(serverHost, serverPort, localPort) {
    this.serverHost = serverHost;
    this.serverPort = serverPort;
    this.localPort = localPort;
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.pendingRequests = new Map();
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = Infinity;
  }

  connect() {
    console.log(`[Client] Connecting to server ${this.serverHost}:${this.serverPort}...`);

    this.socket = net.createConnection(this.serverPort, this.serverHost, () => {
      console.log(`[Client] Connected to server`);
      this.reconnectAttempts = 0;
    });

    this.socket.on('data', (data) => {
      this.handleServerData(data);
    });

    this.socket.on('error', (err) => {
      console.error(`[Client] Connection error:`, err.message);
    });

    this.socket.on('close', () => {
      console.log(`[Client] Connection closed`);
      this.socket = null;
      this.scheduleReconnect();
    });

    this.socket.on('end', () => {
      console.log(`[Client] Server ended connection`);
    });
  }

  scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error(`[Client] Max reconnection attempts reached. Exiting.`);
      process.exit(1);
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;
    console.log(`[Client] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})...`);

    setTimeout(() => {
      if (!this.socket || this.socket.destroyed) {
        this.connect();
      }
    }, delay);
  }

  handleServerData(data) {
    this.buffer = Buffer.concat([this.buffer, data]);

    while (this.buffer.length >= 4) {
      const length = this.buffer.readUInt32BE(0);
      const totalLength = 4 + length;

      if (this.buffer.length < totalLength) {
        break;
      }

      const messageData = this.buffer.slice(4, totalLength);
      this.buffer = this.buffer.slice(totalLength);

      try {
        const message = JSON.parse(messageData.toString());
        this.handleMessage(message);
      } catch (err) {
        console.error(`[Client] Error parsing message:`, err);
      }
    }
  }

  handleMessage(message) {
    switch (message.type) {
      case 'forward':
        this.handleForwardRequest(message);
        break;
      default:
        console.warn(`[Client] Unknown message type: ${message.type}`);
    }
  }

  handleForwardRequest(message) {
    const { id, method, url, headers, body, bodyEncoding } = message;
    console.log(`[Client] Forwarding ${method} ${url} to localhost:${this.localPort} (request ${id})`);

    let requestBody = body;
    if (body && bodyEncoding === 'base64') {
      requestBody = Buffer.from(body, 'base64');
    }

    const options = {
      hostname: 'localhost',
      port: this.localPort,
      path: url,
      method: method,
      headers: {
        ...headers,
        'host': `localhost:${this.localPort}`,
        'connection': 'close'
      }
    };

    const req = http.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => {
        chunks.push(chunk);
      });

      res.on('end', () => {
        const responseBuffer = Buffer.concat(chunks);
        const bodyBase64 = responseBuffer.toString('base64');
        
        this.sendMessage({
          type: 'response',
          id: id,
          status: res.statusCode,
          headers: res.headers,
          body: bodyBase64,
          bodyEncoding: 'base64'
        });
      });
    });

    req.on('error', (err) => {
      console.error(`[Client] Local request error for ${id}:`, err.message);
      const errorBody = Buffer.from(`Bad Gateway: ${err.message}`, 'utf8').toString('base64');
      this.sendMessage({
        type: 'response',
        id: id,
        status: 502,
        headers: { 'Content-Type': 'text/plain' },
        body: errorBody,
        bodyEncoding: 'base64'
      });
    });

    if (requestBody) {
      req.write(requestBody);
    }

    req.end();
  }

  sendMessage(message) {
    if (!this.socket || this.socket.destroyed) {
      console.error('[Client] Cannot send message: not connected');
      return;
    }

    const data = JSON.stringify(message);
    const length = Buffer.byteLength(data);
    const buffer = Buffer.alloc(4 + length);
    buffer.writeUInt32BE(length, 0);
    buffer.write(data, 4);
    this.socket.write(buffer);
  }

  disconnect() {
    if (this.socket) {
      this.socket.end();
      this.socket = null;
    }
  }
}

program
  .name('tunnel-client')
  .description('Tunnel client that forwards local HTTP requests through a tunnel server')
  .requiredOption('-s, --server <host>', 'Tunnel server hostname')
  .requiredOption('-p, --port <port>', 'Tunnel server port', parseInt)
  .requiredOption('-l, --local <port>', 'Local port to forward requests to', parseInt)
  .option('-r, --reconnect <attempts>', 'Max reconnection attempts (default: unlimited)', parseInt, Infinity)
  .parse(process.argv);

const options = program.opts();

const client = new TunnelClient(
  options.server,
  options.port,
  options.local
);

if (options.reconnect !== undefined) {
  client.maxReconnectAttempts = options.reconnect;
}

client.connect();

process.on('SIGINT', () => {
  console.log('\n[Client] Shutting down...');
  client.disconnect();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n[Client] Shutting down...');
  client.disconnect();
  process.exit(0);
});
