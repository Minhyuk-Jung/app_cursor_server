# ADR-007 shared-runtime POC 3 — @cursor/sdk in sandbox container (ops/r01 §6)
FROM node:22-alpine

WORKDIR /opt/cursor-sdk
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY sdk-create.mjs sdk-send.mjs ./

WORKDIR /workspace
CMD ["sleep", "infinity"]
