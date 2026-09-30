FROM node:22-alpine
WORKDIR /app/cloud-run/financial-ai-service
COPY cloud-run/financial-ai-service/package*.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --chown=node:node cloud-run/financial-ai-service/*.js ./
COPY --chown=node:node shared /app/shared
USER node
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "index.js"]
