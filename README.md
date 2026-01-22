# Tunnel Service

A Node.js tunneling service that multiplexes HTTP requests over a persistent connection, allowing you to expose a local service through a public server.

## Features

- **Multiplexing**: Multiple HTTP requests are handled over a single persistent TCP connection
- **Persistent Connection**: Client maintains a persistent connection to the server, automatically reconnecting on failure
- **Request/Response Tracking**: Each request is uniquely identified and tracked through the tunnel
- **Automatic Reconnection**: Client automatically reconnects to the server if the connection is lost

## Architecture

The service consists of two components:

1. **Server** (`server.js`): 
   - Accepts tunnel client connections on a TCP port
   - Runs a public HTTP server that receives incoming requests
   - Forwards HTTP requests through the tunnel to connected clients
   - Routes responses back to the original HTTP clients

2. **Client** (`client.js`):
   - Connects to the tunnel server
   - Receives forwarded requests from the server
   - Makes HTTP requests to a local port
   - Sends responses back through the tunnel

## Installation

```bash
npm install
```

## Usage

### Starting the Server

```bash
npm start
```

Or with custom ports:

```bash
TUNNEL_PORT=8080 HTTP_PORT=3000 node server.js
```

- `TUNNEL_PORT`: Port for tunnel client connections (default: 8080)
- `HTTP_PORT`: Port for public HTTP server (default: 3000)

### Running the Client

```bash
node client.js -s <server-host> -p <server-port> -l <local-port>
```

Example:

```bash
node client.js -s localhost -p 8080 -l 8000
```

This will:
- Connect to the tunnel server at `localhost:8080`
- Forward all tunneled requests to `localhost:8000`

### CLI Options

- `-s, --server <host>`: Tunnel server hostname (required)
- `-p, --port <port>`: Tunnel server port (required)
- `-l, --local <port>`: Local port to forward requests to (required)
- `-r, --reconnect <attempts>`: Maximum reconnection attempts (default: unlimited)

### Running the Test Server

A dummy Express test server is included for testing the tunnel service:

```bash
npm run test-server
```

Or with a custom port:

```bash
PORT=8000 node test-server.js
```

The test server provides several endpoints:
- `GET /` - Root endpoint with server info
- `GET /health` - Health check endpoint
- `POST /echo` - Echo endpoint that returns received data
- `GET /api/users/:id` - Test endpoint with path parameters
- `POST /api/data` - Test POST endpoint
- `GET /api/status/:code` - Returns specified HTTP status code
- `GET /api/delay/:seconds` - Delayed response (max 10 seconds)
- `GET /api/image` - Returns binary data (PNG image)
- `GET /api/large?size=N` - Returns large response (default 1KB)

## Protocol

The tunnel uses a simple binary protocol:

1. **Message Format**: `[4-byte length][JSON message]`
   - First 4 bytes: Big-endian unsigned 32-bit integer indicating JSON message length
   - Remaining bytes: UTF-8 encoded JSON message

2. **Message Types**:

   **Forward Request** (Server → Client):
   ```json
   {
     "type": "forward",
     "id": "request-id",
     "method": "GET",
     "url": "/path",
     "headers": {...},
     "body": "optional body"
   }
   ```

   **Response** (Client → Server):
   ```json
   {
     "type": "response",
     "id": "request-id",
     "status": 200,
     "headers": {...},
     "body": "response body"
   }
   ```

## Example Workflow

1. Start the server:
   ```bash
   npm start
   ```

2. Start the test server (on port 8000):
   ```bash
   npm run test-server
   ```

3. Connect the tunnel client:
   ```bash
   node client.js -s localhost -p 8080 -l 8000
   ```

4. Make requests to the public server:
   ```bash
   curl http://localhost:3000/
   ```

   The request flows:
   - HTTP request → Public server (port 3000)
   - Public server → Tunnel server → Tunnel client
   - Tunnel client → Local service (port 8000)
   - Response flows back through the same path

┌─────────────┐         ┌──────────────┐         ┌─────────────┐
│   Browser   │  HTTP   │ Tunnel Server│  Tunnel │   Client    │  HTTP   │ Local Service │
│             │────────>│  (port 3000) │────────>│  (this cmd) │────────>│  (port 8000) │
└─────────────┘         └──────────────┘         └─────────────┘         └─────────────┐
                                                         ▲                              │
                                                         │                              │
                                                         └──────────────────────────────┘
                                                         Persistent TCP Connection
                                                         (port 8080)
## Error Handling

- **No clients connected**: Public server returns 503 Service Unavailable
- **Request timeout**: Requests timeout after 30 seconds
- **Connection errors**: Client automatically reconnects with exponential backoff
- **Local service errors**: Client returns 502 Bad Gateway

## Limitations

- Currently supports only one client (first connected client receives all requests)
- No authentication or encryption (use TLS/SSL in production)
- No request queuing (requests fail if no client is connected)
