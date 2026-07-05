import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import websocket from "@fastify/websocket";
import { mkdir } from "node:fs/promises";
import {
  assertProductionSandboxPolicy,
  loadConfig,
  type ServerConfig,
} from "./config.js";
import { ensureDevUser, createAuthService } from "./auth/auth.js";
import { PrismaRunEventLog } from "./core/eventlog/prisma-run-event-log.js";
import { StateMachine } from "./core/state/state-machine.js";
import { SdkAdapter } from "./core/sdk/sdk-adapter.js";
import { SessionManager } from "./core/session/session-manager.js";
import { recoverStaleRuns } from "./core/session/recovery.js";
import { Scheduler } from "./core/scheduler/scheduler.js";
import { CommandHandler } from "./core/command/command-handler.js";
import { registerApiRoutes } from "./api/routes.js";
import { registerFileRoutes } from "./api/file-routes.js";
import { registerInboxRoutes } from "./api/inbox-routes.js";
import { registerUsageRoutes } from "./api/usage-routes.js";
import { registerSubscriptionRoutes } from "./api/subscription-routes.js";
import { registerWebhookRoutes } from "./api/webhook-routes.js";
import { registerMcpRoutes } from "./api/mcp-routes.js";
import { registerWebSocket } from "./api/websocket.js";
import { registerGitRoutes } from "./api/git-routes.js";
import { GitService } from "./services/git/git-service.js";
import { FileService } from "./services/file/file-service.js";
import { MAX_ATTACHMENT_BYTES } from "./services/file/file-service.js";
import { InboxHub } from "./core/notification/inbox-hub.js";
import { NotificationEngine, NotificationKind } from "./core/notification/notification-engine.js";
import { deliverCustomWebhook } from "./adapters/custom/custom-adapter.js";
import { listTelegramTargets, listIntranetTargets } from "./auth/channel-link.js";
import {
  formatTelegramOutbound,
  sendTelegramMessage,
} from "./adapters/telegram/telegram-adapter.js";
import { registerChannelRoutes } from "./api/channel-routes.js";
import { registerPushRoutes } from "./api/push-routes.js";
import { startTelegramPullPoller } from "./adapters/telegram/telegram-pull-poller.js";
import { startIntranetPullPoller } from "./adapters/intranet/intranet-pull-poller.js";
import { PushService } from "./services/push/push-service.js";
import { RateLimiter } from "./auth/rate-limit.js";
import { startMaintenanceJobs } from "./jobs/maintenance.js";
import { checkUsageLimit } from "./services/usage/usage-service.js";
import { registerApiKeyRoutes } from "./api/api-key-routes.js";
import { ExecService } from "./services/exec/exec-service.js";
import { PreviewRegistry } from "./services/exec/preview-registry.js";
import { TerminalConnectionRegistry } from "./services/exec/terminal-connection-registry.js";
import { SandboxService } from "./services/exec/sandbox-service.js";
import { SandboxSessionRegistry } from "./services/exec/sandbox-session-registry.js";
import {
  DockerSandboxManager,
  isDockerAvailable,
} from "./services/exec/docker-sandbox-manager.js";
import { registerExecRoutes } from "./api/exec-routes.js";
import { prisma } from "./db/client.js";

export interface AppContext {
  app: FastifyInstance;
  config: ServerConfig;
  eventLog: PrismaRunEventLog;
  stateMachine: StateMachine;
  scheduler: Scheduler;
  sessionManager: SessionManager;
  commandHandler: CommandHandler;
  sdk: SdkAdapter;
  sandboxService: SandboxService;
  execService: ExecService;
  sandboxSessions: SandboxSessionRegistry;
  terminalConnections: TerminalConnectionRegistry;
  telegramPullPoller: ReturnType<typeof startTelegramPullPoller>;
  intranetPullPoller: ReturnType<typeof startIntranetPullPoller>;
}

export async function createApp(
  overrides?: Partial<ServerConfig>,
): Promise<AppContext> {
  const config = { ...loadConfig(), ...overrides };
  assertProductionSandboxPolicy(config.sandboxMode);
  await mkdir(config.workspaceRoot, { recursive: true });
  await ensureDevUser();

  const eventLog = new PrismaRunEventLog();
  await eventLog.init();

  const stateMachine = new StateMachine();
  await stateMachine.hydrate();

  const scheduler = new Scheduler(
    config.maxConcurrentRuns,
    config.queueLimit,
    config.perProjectMaxRuns,
    config.perUserMaxRuns,
  );

  const inboxHub = new InboxHub();
  const gitService = new GitService({
    userName: config.gitUserName,
    userEmail: config.gitUserEmail,
  });
  const pushService = new PushService({
    vapidPublicKey: config.vapidPublicKey ?? "",
    vapidPrivateKey: config.vapidPrivateKey ?? "",
    vapidSubject: config.vapidSubject,
  });
  const notificationEngine = new NotificationEngine(inboxHub, {
    groupWindowMs: config.notificationGroupWindowMs,
    quietHoursStart: config.quietHoursStart,
    quietHoursEnd: config.quietHoursEnd,
    git: gitService,
    push: pushService,
    onWebhook: config.customWebhookUrl
      ? (payload) => deliverCustomWebhook(config.customWebhookUrl!, payload)
      : undefined,
    onTelegram: config.telegramBotToken
      ? async (userId, payload) => {
          const targets = await listTelegramTargets(userId);
          const text = formatTelegramOutbound(payload);
          await Promise.all(
            targets.map((chatId) =>
              sendTelegramMessage(config.telegramBotToken!, chatId, text).catch(
                () => undefined,
              ),
            ),
          );
        }
      : undefined,
    onIntranet: config.intranetMessengerNotifyUrl
      ? async (userId, payload) => {
          const targets = await listIntranetTargets(userId);
          const text = formatTelegramOutbound(payload);
          await Promise.all(
            targets.map((chatId) =>
              fetch(config.intranetMessengerNotifyUrl!, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  ...(config.intranetMessengerAuthHeader
                    ? { Authorization: config.intranetMessengerAuthHeader }
                    : {}),
                },
                body: JSON.stringify({ chatId, text }),
              }).catch(() => undefined),
            ),
          );
        }
      : undefined,
  });

  eventLog.onAppend(async (envelope) => {
    await stateMachine.consume(envelope);
    void notificationEngine.handleEnvelope(envelope);
  });
  stateMachine.onSlotRelease((runId) => scheduler.releaseSlot(runId));

  await recoverStaleRuns(eventLog);

  const sandboxService = new SandboxService({
    sandboxMode: config.sandboxMode,
    execTimeoutMs: config.execTimeoutMs,
    maxConcurrentExec: config.maxConcurrentExec,
    perProjectMaxExec: config.perProjectMaxExec,
    dockerImage: config.sandboxDockerImage,
    sandboxMemoryMb: config.sandboxMemoryMb,
    sandboxCpus: config.sandboxCpus,
    sdkSharedRuntime: config.sdkSharedRuntime,
    sdkInContainer: config.sdkInContainer,
  });

  if (config.sdkSharedRuntime && !config.sdkInContainer) {
    console.warn(
      "[sandbox] SDK_SHARED_RUNTIME is enabled but in-container SDK is not yet implemented. " +
        "SDK still runs on host (sdkRunsOnHost=true). See devplan/ops/r01-mitigation-mode.md §6.",
    );
  }
  if (config.sdkInContainer) {
    console.warn(
      "[sandbox] SDK_IN_CONTAINER is enabled — sessions require @cursor/sdk in sandbox image. " +
        "See SANDBOX_DOCKER_IMAGE and devplan/ops/r01-mitigation-mode.md §6.",
    );
  }

  const dockerManager =
    config.sandboxMode === "docker" && isDockerAvailable()
      ? new DockerSandboxManager({
          networkInternal: config.sandboxNetworkInternal,
        })
      : undefined;

  if (dockerManager) {
    dockerManager.pruneStoppedManagedContainers();
  }

  const sandboxSessions = new SandboxSessionRegistry(
    {
      memoryMb: config.sandboxMemoryMb,
      cpus: config.sandboxCpus,
      execTimeoutMs: config.execTimeoutMs,
    },
    { sandboxService, dockerManager },
  );

  const sdkRuntimeMode =
    config.sdkInContainer && config.sandboxMode === "docker"
      ? ("shared-runtime" as const)
      : config.sdkSharedRuntime && config.sandboxMode === "docker"
        ? ("shared-runtime-pending" as const)
        : ("host" as const);

  const sdk = new SdkAdapter({
    assertWorkspace: (root) => sandboxService.assertProjectWorkspace(root),
    runtimeMode: sdkRuntimeMode,
    assertContainerPrepared:
      sdkRuntimeMode === "shared-runtime-pending" ||
      sdkRuntimeMode === "shared-runtime"
        ? async (projectId, root) => {
            sandboxSessions.ensurePrepared(projectId, root, false);
            const session = sandboxSessions.get(projectId);
            if (session?.containerName) {
              const { verifyContainerNodeRuntime, verifyContainerSdkPackage } =
                await import("./core/sdk/sdk-container-runtime.js");
              verifyContainerNodeRuntime(session.containerName);
              if (sdkRuntimeMode === "shared-runtime") {
                verifyContainerSdkPackage(session.containerName);
              }
            }
          }
        : undefined,
    resolveContainerName:
      sdkRuntimeMode === "shared-runtime"
        ? (projectId) => sandboxSessions.get(projectId)?.containerName
        : undefined,
    containerExecTimeoutMs: config.execTimeoutMs,
  });
  const fileService = new FileService();
  const sessionManager = new SessionManager({
    eventLog,
    sdk,
    apiKey: config.cursorApiKey,
    agentCacheMax: config.agentCacheMax,
    git: gitService,
    autoSnapshot: config.autoSnapshot,
    assertWorkspace: (root) => sandboxService.assertProjectWorkspace(root),
    prepareProjectSandbox:
      config.sandboxMode === "docker"
        ? (projectId, root) => {
            sandboxSessions.ensurePrepared(projectId, root, false);
          }
        : undefined,
  });

  scheduler.setBeforeApprove(async (job) => {
    if (!job.userId) return true;
    const usage = await checkUsageLimit(job.userId, config.usageDailyLimit);
    if (usage.allowed) return true;
    await sessionManager.failRunQuota({
      runId: job.runId,
      sessionId: job.sessionId,
      projectId: job.projectId,
      message: `Daily quota exceeded (${usage.count}/${usage.limit})`,
    });
    await notificationEngine.notifyUsageAlert(
      job.userId,
      NotificationKind.QUOTA_EXCEEDED,
      usage.count,
      usage.limit,
    );
    return false;
  });

  const execServiceWithSessions = new ExecService(
    sandboxService,
    sandboxSessions,
    async (event) => {
      try {
        const project = await prisma.project.findUnique({
          where: { id: event.projectId },
          select: { userId: true, name: true },
        });
        if (!project) return;
        await notificationEngine.notifyExecResourceLimit(
          project.userId,
          event.projectId,
          project.name,
          event.command,
          event.kind === "exec_memory_limit"
            ? NotificationKind.EXEC_MEMORY_LIMIT
            : NotificationKind.EXEC_TIMEOUT,
        );
      } catch (err) {
        console.error("[exec] exec resource limit notification failed:", err);
      }
    },
  );

  const commandHandler = new CommandHandler(
    config,
    sessionManager,
    scheduler,
    eventLog,
    stateMachine,
    gitService,
    notificationEngine,
    execServiceWithSessions,
    fileService,
  );

  const app = Fastify({ logger: false });
  await app.register(cors, {
    origin: process.env.CORS_ORIGIN?.split(",") ?? true,
  });
  await app.register(multipart, {
    limits: { fileSize: MAX_ATTACHMENT_BYTES },
  });

  const auth = createAuthService({
    devApiKey: config.devApiKey,
    jwtSecret: config.jwtSecret,
    jwtAccessTtlSec: config.jwtAccessTtlSec,
    jwtRefreshTtlSec: config.jwtRefreshTtlSec,
  });
  const apiRateLimiter = new RateLimiter(
    config.rateLimitMax,
    config.rateLimitWindowMs,
  );
  const authRateLimiter = new RateLimiter(
    config.authRateLimitMax,
    config.authRateLimitWindowMs,
  );

  const previewRegistry = new PreviewRegistry();
  const terminalConnections = new TerminalConnectionRegistry();

  const telegramPullPoller = startTelegramPullPoller({
    config,
    commandHandler,
  });
  if (telegramPullPoller) {
    console.info(
      "[telegram-pull] P7 pull adapter started (TELEGRAM_PULL_MODE=true)",
    );
  }

  const intranetPullPoller = startIntranetPullPoller({
    config,
    commandHandler,
    notify: config.intranetMessengerNotifyUrl
      ? async (chatId, text) => {
          await fetch(config.intranetMessengerNotifyUrl!, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(config.intranetMessengerAuthHeader
                ? { Authorization: config.intranetMessengerAuthHeader }
                : {}),
            },
            body: JSON.stringify({ chatId, text }),
          }).catch(() => undefined);
        }
      : undefined,
  });
  if (intranetPullPoller) {
    console.info(
      "[intranet-pull] S31 intranet messenger pull started",
    );
  }

  if (
    config.sandboxMode === "subprocess" &&
    process.env.NODE_ENV === "production" &&
    process.env.ALLOW_SUBPROCESS_IN_PRODUCTION === "true"
  ) {
    console.warn(
      "[sandbox] R-01: ALLOW_SUBPROCESS_IN_PRODUCTION is set — mitigation mode only. " +
        "See devplan/ops/r01-mitigation-mode.md",
    );
  }

  await registerApiRoutes(
    app,
    commandHandler,
    auth,
    config,
    sdk,
    { api: apiRateLimiter, auth: authRateLimiter },
    scheduler,
    pushService,
    execServiceWithSessions,
    sandboxSessions,
    previewRegistry,
    sandboxService,
    sessionManager,
    terminalConnections,
    telegramPullPoller,
    intranetPullPoller,
  );
  await registerApiKeyRoutes(app, auth);
  await registerFileRoutes(app, auth, fileService);
  await registerGitRoutes(app, auth, gitService, config);
  await app.register(websocket);
  const sandboxPurgeTimer = setInterval(() => {
    previewRegistry.purgeExpired();
    sandboxSessions.purgeIdle(config.sandboxIdleMs, (projectId) => {
      previewRegistry.revokeForProject(projectId);
      execServiceWithSessions.cancelProjectExecs(projectId);
    });
  }, Math.min(config.sandboxIdleMs, 60_000));
  sandboxPurgeTimer.unref();
  await registerExecRoutes(
    app,
    auth,
    execServiceWithSessions,
    previewRegistry,
    sandboxSessions,
    config.previewTokenTtlSec,
    config.previewPortMin,
    config.previewPortMax,
    terminalConnections,
  );
  await registerInboxRoutes(app, auth);
  if (process.env.E2E_INBOX_SEED === "true") {
    const { registerE2eRoutes } = await import("./api/e2e-routes.js");
    await registerE2eRoutes(app, auth);
  }
  const { registerSttRoutes } = await import("./api/stt-routes.js");
  await registerSttRoutes(app, auth);
  await registerUsageRoutes(app, auth, config);
  await registerPushRoutes(app, auth, pushService);
  await registerSubscriptionRoutes(app, auth);
  await registerChannelRoutes(app, auth);
  await registerWebhookRoutes(app, auth, commandHandler, config);
  await registerMcpRoutes(app, auth, commandHandler, config);
  await registerWebSocket(app, eventLog, auth, inboxHub);

  startMaintenanceJobs(scheduler, config.runEventRetentionDays);

  return {
    app,
    config,
    eventLog,
    stateMachine,
    scheduler,
    sessionManager,
    commandHandler,
    sdk,
    sandboxService,
    execService: execServiceWithSessions,
    sandboxSessions,
    terminalConnections,
    telegramPullPoller,
    intranetPullPoller,
  };
}

/** 13 §6.4 — graceful shutdown: exec 취소·터미널 WS·샌드박스 파기·SDK dispose */
export async function shutdownApp(ctx: AppContext): Promise<void> {
  await ctx.telegramPullPoller?.stop();
  await ctx.intranetPullPoller?.stop();
  ctx.terminalConnections.closeAll();
  ctx.sandboxSessions.purgeAll((projectId) => {
    ctx.execService.cancelProjectExecs(projectId);
  });
  await ctx.sessionManager.disposeAll();
}
