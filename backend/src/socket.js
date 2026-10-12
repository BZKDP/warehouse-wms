const { Server } = require('socket.io');
const { verifyToken } = require('./utils/jwt');

let io = null;

function initSocket(server) {
  io = new Server(server, {
    path: '/sklad/socket.io',
    cors: { origin: '*' },
  });

  // Auth middleware
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('No token'));
    try {
      const payload = verifyToken(token);
      socket.userId = payload.sub;
      socket.userRole = payload.role;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    // Join role-based rooms
    if (socket.userRole === 'admin') socket.join('admins');
    socket.join(`user_${socket.userId}`);

    socket.on('disconnect', () => {});
  });

  console.log('[Socket.IO] Initialized');
}

// Emit events from anywhere in the app
function emitTaskUpdate(taskId, data) {
  if (io) io.to('admins').emit('task:update', { taskId, ...data });
}

function emitScanEvent(taskId, data) {
  if (io) io.to('admins').emit('task:scan', { taskId, ...data });
}

function emitTaskCompleted(taskId, data) {
  if (io) io.to('admins').emit('task:completed', { taskId, ...data });
}

module.exports = { initSocket, emitTaskUpdate, emitScanEvent, emitTaskCompleted };
