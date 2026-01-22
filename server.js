import net from 'net';
import http from 'http';
import { EventEmitter } from 'events';

class TunnelServer extends EventEmitter {
  constructor(port = 8080) {
    super();
    this.port = port;
    this.clients = new Map();
    this.server = null;
  }

  start() {
    this.server = net.createServer((socket) => {
      const clientId = `${socket.remoteAddress}:${socket.remotePort}`;
      console.log(`[Server] New client connected: ${clientId}`);

      const client = {
        socket,
        pendingRequests: new Map(),
        buffer: Buffer.alloc(0)
      };

      this.clients.set(clientId, client);

      socket.on('data', (data) => {
        this.handleClientData(clientId, data);
      });

      socket.on('error', (err) => {
        console.error(`[Server] Client ${clientId} error:`, err.message);
      });

      socket.on('close', () => {
        console.log(`[Server] Client ${clientId} disconnected`);
        this.clients.delete(clientId);
      });
    });

    this.server.listen(this.port, () => {
      console.log(`[Server] Tunnel server listening on port ${this.port}`);
    });

    this.server.on('error', (err) => {
      console.error('[Server] Server error:', err);
      this.emit('error', err);
    });
  }

  handleClientData(clientId, data) {
    const client = this.clients.get(clientId);
    if (!client) return;

    client.buffer = Buffer.concat([client.buffer, data]);

    while (client.buffer.length >= 4) {
      const length = client.buffer.readUInt32BE(0);
      const totalLength = 4 + length;

      if (client.buffer.length < totalLength) {
        break;
      }

      const messageData = client.buffer.slice(4, totalLength);
      client.buffer = client.buffer.slice(totalLength);

      try {
        const message = JSON.parse(messageData.toString());
        this.handleMessage(clientId, message);
      } catch (err) {
        console.error(`[Server] Error parsing message from ${clientId}:`, err);
      }
    }
  }

  handleMessage(clientId, message) {
    const client = this.clients.get(clientId);
    if (!client) return;

    switch (message.type) {
      case 'response':
        this.handleTunnelResponse(clientId, message);
        break;
      default:
        console.warn(`[Server] Unknown message type: ${message.type}`);
    }
  }

  handleTunnelResponse(clientId, message) {
    const { id, status, headers, body, bodyEncoding } = message;
    console.log(`[Server] Received response ${status} for request ${id}`);
    this.emit('response', { clientId, id, status, headers, body, bodyEncoding });
  }

  sendMessage(socket, message) {
    const data = JSON.stringify(message);
    const length = Buffer.byteLength(data);
    const buffer = Buffer.alloc(4 + length);
    buffer.writeUInt32BE(length, 0);
    buffer.write(data, 4);
    socket.write(buffer);
  }

  stop() {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }
}

class PublicHTTPServer {
  constructor(tunnelServer, port = 3000) {
    this.tunnelServer = tunnelServer;
    this.port = port;
    this.httpServer = null;
    this.requestMap = new Map();
  }

  start() {
    this.httpServer = http.createServer((req, res) => {
      this.handlePublicRequest(req, res);
    });

    this.httpServer.listen(this.port, () => {
      console.log(`[HTTP] Public HTTP server listening on port ${this.port}`);
    });

    this.tunnelServer.on('response', ({ clientId, id, status, headers, body, bodyEncoding }) => {
      const requestInfo = this.requestMap.get(id);
      if (requestInfo) {
        const { res, timeout } = requestInfo;
        if (timeout) {
          clearTimeout(timeout);
        }
        if (!res.headersSent) {
          let responseBody = body;
          if (bodyEncoding === 'base64') {
            responseBody = Buffer.from(body, 'base64');
          }
          res.writeHead(status, headers);
          res.end(responseBody);
        }
        this.requestMap.delete(id);
      } else {
        console.warn(`[HTTP] Received response for unknown request ${id}`);
      }
    });
  }

  handlePublicRequest(req, res) {
    const clients = Array.from(this.tunnelServer.clients.values());
    if (clients.length === 0) {
      res.writeHead(503, { 'Content-Type': 'text/plain' });
      res.end('No tunnel clients connected');
      return;
    }

    const client = clients[0];
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });

    req.on('end', () => {
      this.requestMap.set(requestId, { req, res });

      const timeout = setTimeout(() => {
        if (this.requestMap.has(requestId)) {
          console.warn(`[HTTP] Request ${requestId} timed out`);
          const requestInfo = this.requestMap.get(requestId);
          if (requestInfo && !requestInfo.res.headersSent) {
            requestInfo.res.writeHead(504, { 'Content-Type': 'text/plain' });
            requestInfo.res.end('Gateway Timeout');
          }
          this.requestMap.delete(requestId);
        }
      }, 30000);

      this.requestMap.get(requestId).timeout = timeout;

      console.log(`[HTTP] Forwarding ${req.method} ${req.url} to tunnel (request ${requestId})`);
      
      const cleanHeaders = { ...req.headers };
      delete cleanHeaders.host;
      delete cleanHeaders.connection;
      delete cleanHeaders['content-length'];
      
      let requestBody = body;
      let bodyEncoding = undefined;
      if (body) {
        requestBody = Buffer.from(body, 'utf8').toString('base64');
        bodyEncoding = 'base64';
      }
      
      this.tunnelServer.sendMessage(client.socket, {
        type: 'forward',
        id: requestId,
        method: req.method,
        url: req.url,
        headers: cleanHeaders,
        body: requestBody || undefined,
        bodyEncoding: bodyEncoding
      });
    });

    req.on('error', (err) => {
      console.error('[HTTP] Request error:', err);
      if (!res.headersSent) {
        res.writeHead(500);
        res.end('Internal Server Error');
      }
    });
  }

  stop() {
    if (this.httpServer) {
      this.httpServer.close();
      this.httpServer = null;
    }
  }
}

const tunnelPort = process.env.TUNNEL_PORT || 8080;
const httpPort = process.env.HTTP_PORT || 3000;

const tunnelServer = new TunnelServer(tunnelPort);
const httpServer = new PublicHTTPServer(tunnelServer, httpPort);

tunnelServer.start();
httpServer.start();

process.on('SIGINT', () => {
  console.log('\n[Server] Shutting down...');
  tunnelServer.stop();
  httpServer.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n[Server] Shutting down...');
  tunnelServer.stop();
  httpServer.stop();
  process.exit(0);
});
