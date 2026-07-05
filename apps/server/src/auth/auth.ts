import type { ChannelSource, Scope } from "@app/shared";
import { Scope as ScopeEnum } from "@app/shared";
import type { FastifyRequest } from "fastify";
import { createHash } from "node:crypto";
import { prisma } from "../db/client.js";
import { isJwtFormat, signAccessToken, verifyAccessToken } from "./jwt.js";
import { issueRefreshToken, redeemRefreshToken } from "./refresh-token.js";

export type SubjectType = "user" | "machine";

export interface AuthContext {
  subjectType: SubjectType;
  userId: string;
  scopes: Scope[];
  channel?: ChannelSource;
  externalUserId?: string;
}

export interface AuthServiceOptions {
  devApiKey: string;
  jwtSecret?: string;
  jwtAccessTtlSec?: number;
  jwtRefreshTtlSec?: number;
}

declare module "fastify" {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

const DEV_SCOPES: Scope[] = [
  ScopeEnum.PROJECT_READ,
  ScopeEnum.PROJECT_WRITE,
  ScopeEnum.PROMPT_SEND,
  ScopeEnum.RUN_CANCEL,
  ScopeEnum.APPROVAL_RESOLVE,
  ScopeEnum.GIT_WRITE,
  ScopeEnum.TERMINAL_EXEC,
];

function hashKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function createAuthService(
  devApiKeyOrOptions: string | AuthServiceOptions,
) {
  const options: AuthServiceOptions =
    typeof devApiKeyOrOptions === "string"
      ? { devApiKey: devApiKeyOrOptions }
      : devApiKeyOrOptions;

  const { devApiKey, jwtSecret, jwtAccessTtlSec = 3600, jwtRefreshTtlSec = 604_800 } =
    options;

  async function resolveApiKey(token: string): Promise<AuthContext | null> {
    if (token === devApiKey) {
      return {
        subjectType: "user",
        userId: "dev-user",
        scopes: DEV_SCOPES,
      };
    }

    const apiKey = await prisma.apiKey.findUnique({
      where: { hashedKey: hashKey(token) },
    });
    if (!apiKey) return null;
    if (apiKey.expiresAt && apiKey.expiresAt < new Date()) return null;

    return {
      subjectType: "machine",
      userId: apiKey.userId,
      scopes: apiKey.scopes.split(",").filter(Boolean) as Scope[],
    };
  }

  return {
    async authenticate(request: FastifyRequest): Promise<AuthContext | null> {
      const header = request.headers.authorization;
      if (!header?.startsWith("Bearer ")) return null;
      const token = header.slice("Bearer ".length);

      if (jwtSecret && isJwtFormat(token)) {
        const payload = verifyAccessToken(token, jwtSecret);
        if (!payload) return null;
        return {
          subjectType: "user",
          userId: payload.sub,
          scopes: payload.scopes,
        };
      }

      return resolveApiKey(token);
    },

    async resolveApiKey(token: string): Promise<AuthContext | null> {
      return resolveApiKey(token);
    },

    issueJwt(ctx: AuthContext): {
      accessToken: string;
      expiresAt: string;
      refreshToken: string;
      refreshExpiresAt: string;
    } | null {
      if (!jwtSecret) return null;
      const { token, expiresAt } = signAccessToken(
        ctx.userId,
        ctx.scopes,
        jwtSecret,
        jwtAccessTtlSec,
      );
      const refresh = issueRefreshToken(
        ctx.userId,
        ctx.scopes,
        jwtRefreshTtlSec * 1000,
      );
      return {
        accessToken: token,
        expiresAt,
        refreshToken: refresh.refreshToken,
        refreshExpiresAt: refresh.expiresAt,
      };
    },

    refreshJwt(refreshToken: string): {
      accessToken: string;
      expiresAt: string;
      refreshToken: string;
      refreshExpiresAt: string;
    } | null {
      if (!jwtSecret) return null;
      const ctx = redeemRefreshToken(refreshToken);
      if (!ctx) return null;
      const { token, expiresAt } = signAccessToken(
        ctx.userId,
        ctx.scopes,
        jwtSecret,
        jwtAccessTtlSec,
      );
      const refresh = issueRefreshToken(
        ctx.userId,
        ctx.scopes,
        jwtRefreshTtlSec * 1000,
      );
      return {
        accessToken: token,
        expiresAt,
        refreshToken: refresh.refreshToken,
        refreshExpiresAt: refresh.expiresAt,
      };
    },

    requireScope(ctx: AuthContext, scope: Scope): boolean {
      return ctx.scopes.includes(scope);
    },
  };
}

export function unauthorized(): AppErrorShape {
  return {
    code: "unauthorized",
    message: "Invalid or missing API key",
    retryable: false,
  };
}

export function tokenExpired(): AppErrorShape {
  return {
    code: "token_expired",
    message: "Access token expired",
    retryable: false,
  };
}

export function forbidden(): AppErrorShape {
  return {
    code: "forbidden",
    message: "Insufficient scope",
    retryable: false,
  };
}

interface AppErrorShape {
  code: string;
  message: string;
  retryable: boolean;
}

export async function ensureDevUser(): Promise<void> {
  await prisma.user.upsert({
    where: { id: "dev-user" },
    create: { id: "dev-user" },
    update: {},
  });
}

export type AuthService = ReturnType<typeof createAuthService>;
