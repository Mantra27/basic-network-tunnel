import express from 'express';

const app = express();
const PORT = process.env.PORT || 8000;

app.use(express.json());
app.use(express.text());

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

app.get('/', (req, res) => {
  res.json({
    message: 'Hello from test server!',
    timestamp: new Date().toISOString(),
    method: req.method,
    path: req.path,
    headers: req.headers
  });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

app.post('/echo', (req, res) => {
  res.json({
    message: 'Echo endpoint',
    received: {
      body: req.body,
      headers: req.headers,
      method: req.method,
      query: req.query
    }
  });
});

app.get('/api/users/:id', (req, res) => {
  res.json({
    message: 'User endpoint',
    userId: req.params.id,
    query: req.query,
    timestamp: new Date().toISOString()
  });
});

app.post('/api/data', (req, res) => {
  res.json({
    message: 'Data received',
    data: req.body,
    contentType: req.get('content-type'),
    timestamp: new Date().toISOString()
  });
});

app.get('/api/status/:code', (req, res) => {
  const code = parseInt(req.params.code);
  if (isNaN(code) || code < 100 || code > 599) {
    return res.status(400).json({ error: 'Invalid status code' });
  }
  res.status(code).json({
    status: code,
    message: `Response with status ${code}`,
    timestamp: new Date().toISOString()
  });
});

app.get('/api/delay/:seconds', (req, res) => {
  const seconds = parseInt(req.params.seconds) || 1;
  const delay = Math.min(seconds, 10) * 1000;
  
  setTimeout(() => {
    res.json({
      message: `Delayed response after ${seconds} second(s)`,
      timestamp: new Date().toISOString()
    });
  }, delay);
});

app.get('/api/image', (req, res) => {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  );
  res.setHeader('Content-Type', 'image/png');
  res.send(png);
});

app.get('/api/large', (req, res) => {
  const size = parseInt(req.query.size) || 1024;
  const data = 'x'.repeat(size);
  res.json({
    message: `Large response (${size} bytes)`,
    data: data,
    size: size
  });
});

app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    path: req.path,
    method: req.method
  });
});

app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({
    error: 'Internal Server Error',
    message: err.message
  });
});

app.listen(PORT, () => {
  console.log(`[Test Server] Listening on http://localhost:${PORT}`);
  console.log(`[Test Server] Try these endpoints:`);
  console.log(`  - GET  http://localhost:${PORT}/`);
  console.log(`  - GET  http://localhost:${PORT}/health`);
  console.log(`  - POST http://localhost:${PORT}/echo`);
  console.log(`  - GET  http://localhost:${PORT}/api/users/123`);
  console.log(`  - GET  http://localhost:${PORT}/api/status/200`);
  console.log(`  - GET  http://localhost:${PORT}/api/delay/2`);
  console.log(`  - GET  http://localhost:${PORT}/api/image`);
  console.log(`  - GET  http://localhost:${PORT}/api/large?size=2048`);
});

process.on('SIGINT', () => {
  console.log('\n[Test Server] Shutting down...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n[Test Server] Shutting down...');
  process.exit(0);
});
