import dotenv from 'dotenv';
import { createApiApp } from './app.js';

dotenv.config();

const port = Number(process.env.API_PORT || process.env.PORT || 4000);
const host = process.env.API_HOST || process.env.HOST || '0.0.0.0';

async function bootstrap() {
  const { app, close } = await createApiApp({
    logger: {
      level: process.env.LOG_LEVEL || 'info',
    },
  });

  const shutdown = async (signal: string) => {
    console.log(`Received ${signal}, shutting down Enterprise Blogger API...`);
    await close();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  try {
    await app.listen({ port, host });
    console.log(`🚀 Enterprise Blogger API running on http://${host}:${port}`);
  } catch (err) {
    console.error('Failed to start API server:', err);
    process.exit(1);
  }
}

bootstrap();
