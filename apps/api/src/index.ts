import dotenv from 'dotenv';
import { createApiApp } from './app.js';
import { bootstrapLocalAdmin } from './db/bootstrap-admin.js';

dotenv.config();

const port = Number(process.env.API_PORT || process.env.PORT || 4000);
const host = process.env.API_HOST || process.env.HOST || '0.0.0.0';

async function bootstrap() {
  let close: (() => Promise<void>) | undefined;

  try {
    const instance = await createApiApp({
      logger: {
        level: process.env.LOG_LEVEL || 'info',
      },
    });
    const { app, db } = instance;
    close = instance.close;

    const bootstrapResult = await bootstrapLocalAdmin(db);
    if (bootstrapResult.created) {
      console.log('Created the explicitly configured local administrator.');
    }

    const shutdown = async (signal: string) => {
      console.log(`Received ${signal}, shutting down Glyphroom API...`);
      await close!();
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    await app.listen({ port, host });
    console.log(`🚀 Glyphroom API running on http://${host}:${port}`);
  } catch (err) {
    console.error('Failed to start API server:', err);
    if (close) {
      try {
        await close();
      } catch (closeError) {
        console.error('Failed to clean up API resources after startup error:', closeError);
      }
    }
    process.exit(1);
  }
}

void bootstrap();
