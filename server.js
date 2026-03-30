require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const jwt = require('jsonwebtoken');
const compression = require('compression');

if (!process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET is not set in .env');
  process.exit(1);
}

const app = express();
const server = http.createServer(app);

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : ['http://localhost:9000', 'http://127.0.0.1:9000'];

const io = socketIo(server, {
  cors: { origin: allowedOrigins, methods: ['GET', 'POST'] },
  // Tune Socket.IO for high concurrency
  pingTimeout: 20000,
  pingInterval: 25000,
  maxHttpBufferSize: 1e6 // 1MB max socket message
});

// ── Middleware ────────────────────────────────────────────────────────────────

// Gzip all responses — cuts bandwidth ~70%
app.use(compression());

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
  // unsafe-eval required by Socket.IO client bundle
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' wss: ws:;"
  );
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

// Request timeout — kill requests that hang longer than 30s
app.use((req, res, next) => {
  res.setTimeout(30000, () => {
    res.status(503).json({ message: 'Request timed out. Please try again.' });
  });
  next();
});

app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static('public', {
  maxAge: process.env.NODE_ENV === 'production' ? '1d' : 0 // cache static files in prod
}));

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/auth',      require('./routes/auth'));
app.use('/api/services',  require('./routes/services'));
app.use('/api/requests',  require('./routes/requests'));
app.use('/api/payments',  require('./routes/payments'));
app.use('/api/locations', require('./routes/locations'));
app.use('/api/admin',     require('./routes/admin'));

// ── Socket.IO ─────────────────────────────────────────────────────────────────
io.use((socket, next) => {
  const token = socket.handshake.auth?.token || socket.handshake.query?.token;
  if (!token) return next(new Error('Authentication required'));
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.user = decoded;
    socket.user.userId = decoded.userId || decoded.id || String(decoded._id);
    next();
  } catch {
    next(new Error('Invalid token'));
  }
});

io.on('connection', (socket) => {
  socket.on('join-room',          (roomId)     => socket.join(roomId));
  socket.on('join-location',      (locationId) => socket.join(`location-${locationId}`));
  socket.on('leave-location',     (locationId) => socket.leave(`location-${locationId}`));
  socket.on('send-message',       (data)       => io.to(data.roomId).emit('receive-message', data));
  socket.on('user-typing',        (data)       => socket.to(data.roomId).emit('user-typing', data));
  socket.on('user-stopped-typing',(data)       => socket.to(data.roomId).emit('user-stopped-typing', data));
});

app.set('io', io);

// ── MongoDB ───────────────────────────────────────────────────────────────────
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/standin-app', {
  maxPoolSize: 20,        // up to 20 concurrent DB connections per worker
  minPoolSize: 5,         // keep 5 warm connections ready
  serverSelectionTimeoutMS: 5000,  // fail fast if DB unreachable
  socketTimeoutMS: 30000, // drop idle DB sockets after 30s
  heartbeatFrequencyMS: 10000
})
  .then(() => console.log(`Worker ${process.pid}: MongoDB connected`))
  .catch(err => {
    console.error('MongoDB connection error:', err);
    process.exit(1); // worker exits → master restarts it
  });

// ── Error handling ────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: 'Internal server error' });
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────
// Finish in-flight requests before dying — prevents data corruption
function gracefulShutdown(signal) {
  console.log(`Worker ${process.pid} received ${signal}. Shutting down gracefully...`);
  server.close(async () => {
    try {
      await mongoose.connection.close();
      console.log(`Worker ${process.pid}: DB connection closed. Exiting.`);
    } catch (e) {
      console.error('Error closing DB:', e);
    }
    process.exit(0);
  });

  // Force exit after 15s if requests don't finish
  setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 15000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));

const PORT = process.env.PORT || 9000;
server.listen(PORT, () => {
  console.log(`Worker ${process.pid} listening on port ${PORT}`);
});
