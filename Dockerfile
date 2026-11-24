# --- build stage -------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json tsconfig.json ./
RUN npm install --no-fund --no-audit --ignore-scripts
COPY src/ src/
RUN npx tsc -p tsconfig.json

# --- runtime stage -----------------------------------------------------------
FROM node:22-alpine
RUN addgroup -g 10001 -S rsb && adduser -u 10001 -S -G rsb rsb
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/dist/ dist/
COPY static/ static/
COPY examples/ examples/
COPY package.json ./
USER rsb
EXPOSE 7420
HEALTHCHECK --interval=30s --timeout=4s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:7420/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist/cli.js", "serve", "--port", "7420"]
