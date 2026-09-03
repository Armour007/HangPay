# Multi-stage build for HangPay
FROM node:24-alpine AS builder

WORKDIR /app

# Install Rust for native module
RUN apk add --no-cache rust cargo python3 make g++

COPY package*.json ./
COPY native/ ./native/
RUN npm ci

COPY . .
RUN npm run build:native && npm run build

# Runtime stage
FROM node:24-alpine AS runtime

WORKDIR /app

# Install Chrome dependencies
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    freetype-dev \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    && rm -rf /var/cache/apk/*

# Create non-root user
RUN addgroup -g 1000 -S hangpayuser && \
    adduser -u 1000 -S hangpayuser -G hangpayuser

# Copy built artifacts
COPY --from=builder --chown=hangpayuser:hangpayuser /app/dist ./dist
COPY --from=builder --chown=hangpayuser:hangpayuser /app/native/hangpay-native.*.node ./native/
COPY --from=builder --chown=hangpayuser:hangpayuser /app/dashboard ./dashboard
COPY --from=builder --chown=hangpayuser:hangpayuser /app/package*.json ./
COPY --from=builder --chown=hangpayuser:hangpayuser /app/node_modules ./node_modules

# Create config directory
RUN mkdir -p /home/hangpayuser/.config/hangpay && \
    chown -R hangpayuser:hangpayuser /home/hangpayuser

USER hangpayuser

ENV HANGPAY_CDP_URL=http://chromium:9222
ENV HANGPAY_AUTO_INJECT=true

ENTRYPOINT ["node", "dist/cli-main.js"]