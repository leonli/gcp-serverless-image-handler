import express, { Request, Response } from 'express';
import cors from 'cors';
import sharp from 'sharp';
import { StatusCodes, ContentTypes } from './lib/enums';
import { ImageHandlerEvent, ImageHandlerError } from './lib/types';
import { ImageRequest } from './image-request';
import { ImageHandler } from './image-handler';

const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health check endpoint
app.get('/health', (_req: Request, res: Response) => {
  res.status(StatusCodes.OK).json({
    status: 'UP',
    service: 'gcp-serverless-image-handler',
  });
});

// Catch-all image processing route
app.all('*', async (req: Request, res: Response) => {
  if (req.path === '/health') return;

  try {
    const event: ImageHandlerEvent = {
      path: req.path,
      queryStringParameters: req.query as Record<string, string>,
      headers: req.headers as Record<string, string>,
    };

    const requestInfo = await ImageRequest.setup(event);
    const processedBuffer = await ImageHandler.process(requestInfo);

    // Determine appropriate Content-Type
    let contentType = 'application/octet-stream';
    const toFormat = requestInfo.edits?.toFormat || requestInfo.edits?.format;

    if (toFormat) {
      const formatKey = toFormat.toUpperCase();
      contentType = (ContentTypes as any)[formatKey] || `image/${toFormat.toLowerCase()}`;
    } else if (requestInfo.key) {
      const ext = requestInfo.key.split('.').pop()?.toLowerCase();
      if (ext === 'jpg' || ext === 'jpeg') contentType = ContentTypes.JPEG;
      else if (ext === 'png') contentType = ContentTypes.PNG;
      else if (ext === 'webp') contentType = ContentTypes.WEBP;
      else if (ext === 'avif') contentType = ContentTypes.AVIF;
      else if (ext === 'gif') contentType = ContentTypes.GIF;
      else if (ext === 'tiff') contentType = ContentTypes.TIFF;
      else if (ext === 'heif') contentType = ContentTypes.HEIF;
    }

    if (contentType === 'application/octet-stream') {
      try {
        const meta = await sharp(processedBuffer).metadata();
        if (meta.format) {
          const formatKey = meta.format.toUpperCase();
          contentType = (ContentTypes as any)[formatKey] || `image/${meta.format.toLowerCase()}`;
        }
      } catch (e) {
        // Keep octet-stream if sharp metadata check fails
      }
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(StatusCodes.OK).send(processedBuffer);
  } catch (error: any) {
    const statusCode = error instanceof ImageHandlerError
      ? error.statusCode
      : error.statusCode || StatusCodes.INTERNAL_SERVER_ERROR;
    const code = error instanceof ImageHandlerError
      ? error.code
      : error.code || 'InternalServerError';
    const message = error.message || 'An unexpected error occurred';

    res.status(statusCode).json({
      status: statusCode,
      code,
      message,
    });
  }
});

// Start server if executed directly
if (require.main === module) {
  const PORT = process.env.PORT || 8080;
  const server = app.listen(PORT, () => {
    console.log(`gcp-serverless-image-handler listening on port ${PORT}`);
  });

  const shutdown = (signal: string) => {
    console.log(`Received ${signal}. Graceful shutdown initiated...`);
    server.close(() => {
      console.log('HTTP server closed.');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

export default app;
