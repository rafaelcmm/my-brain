import { MiniLmEmbeddingAdapter } from '../adapters/outbound/embeddings/minilm-embedding-adapter.js';
import { SonaAdaptiveBrainAdapter } from '../adapters/outbound/sona/sona-adaptive-brain-adapter.js';
import { FileAuthTokenAdapter } from '../adapters/outbound/security/file-auth-token-adapter.js';
import { McpBrainServer } from '../adapters/inbound/mcp/mcp-brain-server.js';
import { FeedbackUseCase } from '../core/application/use-cases/feedback-use-case.js';
import { InspectInteractionUseCase } from '../core/application/use-cases/inspect-interaction-use-case.js';
import { LearnUseCase } from '../core/application/use-cases/learn-use-case.js';
import { QueryUseCase } from '../core/application/use-cases/query-use-case.js';
import type { RuntimeConfig } from '../shared/config/env.js';
import { loadRuntimeConfig } from '../shared/config/env.js';

/**
 * Creates fully-wired application graph for runtime entrypoint.
 *
 * @param config Pre-validated runtime config. When omitted, configuration is
 * loaded from environment by this composition root.
 */
export function createApp(config: RuntimeConfig = loadRuntimeConfig()): McpBrainServer {
  const embeddingsPort = new MiniLmEmbeddingAdapter(
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
  const inspectInteractionUseCase = new InspectInteractionUseCase(
    embeddingsPort,
    adaptiveBrainPort,
  );
  const feedbackUseCase = new FeedbackUseCase(adaptiveBrainPort);
  const learnUseCase = new LearnUseCase(adaptiveBrainPort);
  const authTokens =
    config.mcpTransport === 'http' ? new FileAuthTokenAdapter(config.mcpAuthStorePath) : undefined;

  return new McpBrainServer(
    config.serverName,
    config.serverVersion,
    queryUseCase,
    inspectInteractionUseCase,
    feedbackUseCase,
    learnUseCase,
    {
      authTokens,
      bootstrapToken: config.mcpAuthToken,
      allowedOrigins: config.mcpAllowedOrigins,
      maxBodyBytes: config.mcpMaxBodyBytes,
      rateLimitWindowMs: config.mcpRateLimitWindowMs,
      rateLimitMax: config.mcpRateLimitMax,
    },
  );
}
