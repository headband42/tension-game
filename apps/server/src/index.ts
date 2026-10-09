import { Hono } from 'hono';
import { Server } from 'socket.io';
import { PrismaClient } from '@prisma/client';
import http from 'http';
import { gameSocketHandler } from './socket/game.js';
import { gameRoutes } from './routes/games.js';
import { categoryRoutes } from './routes/categories.js';
import { questionRoutes } from './routes/questions.js';

const app = new Hono();
const prisma = new PrismaClient();

// Middleware
app.use('*', async (c, next) => {
  c.set('prisma', prisma);
  await next();
});

// Health check
app.get('/', (c) => c.json({ status: 'ok', service: 'tension-game-api' }));

// API Routes
app.route('/api/games', gameRoutes);
app.route('/api/categories', categoryRoutes);
app.route('/api/questions', questionRoutes);

// Create HTTP server
const PORT = parseInt(process.env.PORT || '3001');

const server = http.createServer(async (req, res) => {
  try {
    const url = `http://${req.headers.host}${req.url}`;
    const method = req.method || 'GET';
    const headers = new Headers();
    
    Object.entries(req.headers).forEach(([key, value]) => {
      if (value && typeof value === 'string') {
        headers.set(key, value);
      }
    });

    let body: BodyInit | undefined;
    if (method !== 'GET' && method !== 'HEAD') {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(chunk);
      }
      if (chunks.length > 0) {
        body = Buffer.concat(chunks);
      }
    }

    const request = new Request(url, { method, headers, body });
    const response = await app.fetch(request);
    
    res.statusCode = response.status;
    res.statusMessage = response.statusText;
    
    response.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });

    const responseBody = await response.arrayBuffer();
    res.end(Buffer.from(responseBody));
  } catch (error) {
    console.error('Server error:', error);
    res.statusCode = 500;
    res.end(JSON.stringify({ error: 'Internal server error' }));
  }
});

// Setup Socket.io
const io = new Server(server, {
  cors: {
    origin: process.env.WEB_URL || '*',
    methods: ['GET', 'POST'],
  },
  transports: ['websocket', 'polling'],
});

// Socket.io game handler
gameSocketHandler(io, prisma);

server.listen(PORT, () => {
  console.log(`🎮 Tension Game Server running on http://localhost:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down...');
  await prisma.$disconnect();
  server.close();
  process.exit(0);
});
