# Agent guidelines for Couchbase hackathon

This project uses **Polytope** (and tooling from **bluetext**) to run services in sandboxes. Use the Polytope MCP and the skills below so work stays consistent and runnable.

---

## Polytope & bluetext MCP

- **Server**: `project-0-couchbase-polytope` (Polytope sandbox; bluetext repo is included via `polytope.yml`).
- **First step**: Call **`get-server-instructions`** (no args) to get current usage instructions and when to use which tools.
- **Before calling any tool**: Read the tool’s schema under the MCP server’s `tools/` descriptor so you pass the right arguments.

### Running the stack

- **`stack`** – Runs the full stack defined in [polytope.yml](polytope.yml): `load-config` → `couchbase-server` → `python-fast-api` → `react-web-app` → `service-config-manager`. Use this to start or restart the whole environment.
- **`run-service`** – Run a single service by name (e.g. `react-web-app`, `python-fast-api`, `couchbase-server`).
- **`add-and-run-stack`** – One-shot setup: template `full-stack` scaffolds and runs couchbase-server + python-fast-api + react-web-app + service-config-manager.

### Dependencies and config

- **`add-dependency`** – Add packages to a service. Required: `packages` (string), `service` (e.g. `react-web-app`), `type` (`node` for Bun/npm, `python` for uv). Use this instead of running `bun add` / `npm install` / `uv add` directly in the repo when working against the Polytope sandbox.
- **`load-config`** – Load [config/values.yml](config/values.yml) and config/secrets.yml into the Polytope context. Use when the session should pick up existing config.

### Inspection and debugging

- **`list-services`** – List services (optional filters: `like`, `tags`, `limit`). Use to see what’s running and get service IDs/ports.
- **`list-containers`** – List containers.
- **`get-container-logs`** – Fetch logs for a container.
- **`call-endpoint`** – Call an HTTP endpoint (e.g. to hit the React app or Python API once they’re up).

### React app specifics

- Service id: **`react-web-app`**. Add frontend deps with `add-dependency` (e.g. `service: "react-web-app"`, `type: "node"`, `packages: "package-name"`).
- The app runs in the sandbox; after the stack (or `run-service` for `react-web-app`) is running, use the URL/port from the tool output or `list-services` to open it in a browser or use **cursor-ide-browser** MCP for automated testing.

---

## Skills (use when relevant)

- **frontend-design** (`.agents/skills/frontend-design`) – Use when building or refining **web UIs**: pages, dashboards, React components, layouts, or styling. It emphasizes distinctive aesthetics, typography, color, motion, and avoiding generic “AI” look. Prefer this for any net-new UI or major visual overhaul.
- **framer-motion-animator** (`.agents/skills/framer-motion-animator`) – Use when adding or changing **animations** with Framer Motion: transitions, gestures, AnimatePresence, layout animations, staggered sequences. Read the skill when implementing things like “animate this list,” “add a pulse,” or “smooth merge/exit” so patterns match the skill’s recommendations.

---

## Other MCPs

- **cursor-ide-browser** – Use for in-browser checks of the React app (navigate, snapshot, click, type). Follow its lock/unlock and snapshot-before-interact rules.
- **user-context7** – Use for up-to-date docs and examples (e.g. `query-docs`, `resolve-library-id`) when you need library/framework details.

---

## Summary

1. Call **`get-server-instructions`** when starting or when unsure how to use Polytope.
2. Use **Polytope** for running the stack, services, and adding dependencies; use **bluetext** tooling as exposed through that MCP (e.g. stack, add-and-run-stack).
3. Use **frontend-design** for UI/dashboard work and **framer-motion-animator** for Framer Motion animations.
4. Check tool schemas in the MCP `tools/` folder before calling any Polytope or browser tool.
