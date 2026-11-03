FROM docker.io/library/node:22-alpine@sha256:025b8e975a61d94e33abeafaad1255ef44e4898cf1a1b6446860009c72e6d284
ARG SOURCE_REVISION
LABEL org.opencontainers.image.source="https://github.com/0xCaptain888/flashfirm" \
      org.opencontainers.image.description="Dependency-free exact quotation verifier using dstack attestation; no wallet or AI provider secrets" \
      org.opencontainers.image.revision="${SOURCE_REVISION}"
WORKDIR /app
COPY phala-worker.mjs ./phala-worker.mjs
EXPOSE 3000
CMD ["node", "/app/phala-worker.mjs"]
