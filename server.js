const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Middleware
app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));
app.use(express.static('public'));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/services', require('./routes/services'));
app.use('/api/requests', require('./routes/requests'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/locations', require('./routes/locations'));
app.use('/api/admin', require('./routes/admin'));

// Socket.IO for real-time communication
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  
  socket.on('join-room', (roomId) => {
    socket.join(roomId);
  });
  
  // Location sharing rooms
  socket.on('join-location', (locationId) => {
    socket.join(`location-${locationId}`);
  });
  
  socket.on('leave-location', (locationId) => {
    socket.leave(`location-${locationId}`);
  });
  
  socket.on('send-message', (data) => {
    // Broadcast to everyone in the room INCLUDING sender
    io.to(data.roomId).emit('receive-message', data);
  });

  socket.on('user-typing', (data) => {
    socket.to(data.roomId).emit('user-typing', data);
  });

  socket.on('user-stopped-typing', (data) => {
    socket.to(data.roomId).emit('user-stopped-typing', data);
  });

});

// Make io available to routes
app.set('io', io);

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/standin-app')
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

// Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: 'Internal server error' });
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});

const PORT = process.env.PORT || 9000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
