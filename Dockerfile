# --- deps ---------------------------------------------------------------
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# Using `npm install` rather than `npm ci` here: the committed lockfile can
# drift slightly from package.json when `npm install` is run locally on a
# different OS/npm version (e.g. picks up different platform-specific
# optional dependencies for native addons like lightningcss). `npm ci`
# refuses to install at all when that happens; `npm install` reconciles it.
RUN npm install

# --- build ---------------------------------------------------------------
FROM node:22-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# NEXT_PUBLIC_* vars are inlined into the browser bundle at BUILD time, not
# read at container startup — so they must arrive as Docker build args.
# In Coolify: set these three as environment variables on the app AND tick
# "Is Build Variable" for NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY
# so Coolify passes them into `docker build` as --build-arg.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
# Same story for the Web Push public key: it's not secret (it has to be
# readable by any browser subscribing to push), but like the vars above it
# still needs to be a Coolify Build Variable, or the browser bundle will be
# built without it and push subscribe will silently no-op.
ARG NEXT_PUBLIC_VAPID_PUBLIC_KEY
ENV NEXT_PUBLIC_VAPID_PUBLIC_KEY=$NEXT_PUBLIC_VAPID_PUBLIC_KEY
# SUPABASE_SERVICE_ROLE_KEY is server-only and never touches the browser
# bundle, so a placeholder here is fine — the real value is supplied at
# container runtime via Coolify's normal (non-build) environment variables.
ENV SUPABASE_SERVICE_ROLE_KEY=placeholder-replaced-at-runtime

RUN npm run build

# --- runtime ---------------------------------------------------------------
# Not using `.next/standalone` here: this app runs a small custom server.js
# (see that file) so it can proxy the Supabase Realtime WebSocket upgrade,
# which Next.js's own `rewrites()` cannot forward. A standalone build's
# generated server.js can't easily be extended with a custom `upgrade`
# handler, so the runtime image ships full node_modules instead — fine for
# an internal tool where a slightly larger image doesn't matter.
FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/server.js ./server.js

EXPOSE 3000
CMD ["node", "server.js"]
