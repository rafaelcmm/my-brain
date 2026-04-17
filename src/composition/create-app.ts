import { HashEmbeddingAdapter } from '../adapters/outbound/embeddings/hash-embedding-adapter.js';
import { MiniLmEmbeddingAdapter } from '../adapters/outbound/embeddings/minilm-embedding-adapter.js';
import { SonaAdaptiveBrainAdapter } from '../adapters/outbound/sona/sona-adaptive-brain-adapter.js';
import { McpBrainServer } from '../adapters/inbound/mcp/mcp-brain-server.js';
import { FeedbackUseCase } from '../core/application/use-cases/feedback-use-case.js';
import { LearnUseCase } from '../core/application/use-cases/learn-use-case.js';
import { QueryUseCase } from '../core/application/use-cases/query-use-case.js';
import { loadRuntimeConfig } from '../shared/config/env.js';

/**
 * Creates fully-wired application graph for runtime entrypoint.
 */
export function createApp(): McpBrainServer {
  const config = loadRuntimeConfig();

  const embeddingsPort =
    config.embeddingProvider === 'hash'
      ? new HashEmbeddingAdapter(config.embeddingDim)
      : new MiniLmEmbeddingAdapter(
          config.embeddingModelId,
          config.embeddingDim,
          config.modelCacheDir,
          config.embeddingQuantized,
        );

  const adaptiveBrainPort = new SonaAdaptiveBrainAdapter(
    embeddingsPort.getDimension(),
    config.ruvectorDbPath,
    {
      microLoraRank: config.sonaMicroLoraRank,
      baseLoraRank: config.sonaBaseLoraRank,
      microLoraLr: config.sonaMicroLoraLr,
      qualityThreshold: config.sonaQualityThreshold,
      patternClusters: config.sonaPatternClusters,
      ewcLambda: config.sonaEwcLambda,
    },
  );

  const queryUseCase = new QueryUseCase(embeddingsPort, adaptiveBrainPort);
  const feedbackUseCase = new FeedbackUseCase(adaptiveBrainPort);
  const learnUseCase = new LearnUseCase(adaptiveBrainPort);

  return new McpBrainServer(
    config.serverName,
    config.serverVersion,
    queryUseCase,
    feedbackUseCase,
    learnUseCase,
    {
      authToken: config.mcpAuthToken,
      allowedOrigins: config.mcpAllowedOrigins,
      maxBodyBytes: config.mcpMaxBodyBytes,
      rateLimitWindowMs: config.mcpRateLimitWindowMs,
      rateLimitMax: config.mcpRateLimitMax,
    },
  );
}
