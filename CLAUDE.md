# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Inventario** is a multi-tenant SaaS inventory and sales management system targeting Colombian businesses (Spanish locale, Colombian pesos COP). It is composed of a Node.js/Express backend and a React 19 + Vite frontend in separate subdirectories.

---

## Commands

### Backend (`/backend`)
```bash
npm run dev      # nodemon dev server on port 3001
npm start        # production
```

### Frontend (`/frontend`)
```bash
pnpm dev         # Vite dev server on port 5173
pnpm build       # production build
pnpm lint        # ESLint
pnpm preview     # preview production build
```

> Frontend uses **pnpm**, backend uses **npm**.

---

## Architecture

### Multi-tenant Model

The hierarchy is: **Negocio (business) → Sucursales (branches) → Users (roles)**.

Three roles exist: `admin_negocio`, `supervisor`, `vendedor`. Role determines which sucursal is resolved:
- `admin_negocio` passes `sucursal_id` as a query parameter on every request.
- `supervisor` / `vendedor` have their sucursal embedded in the JWT and resolved server-side.

### Authentication Flow

1. Login returns an **access token** (8h) + sets an httpOnly cookie with a **refresh token** (7d).
2. The Axios instance in `frontend/src/api/` auto-refreshes on 401 via an interceptor.
3. A 403 with plan status `vencido` or `suspendido` redirects the user to `/plan-bloqueado`.

### Backend Module Pattern

All 27 feature modules under `backend/src/` follow the same layered structure:

```
<module>/
  routes.js       → Express router, middleware wiring
  controller.js   → HTTP in/out, calls service
  service.js      → Business logic
  repository.js   → Raw SQL queries via pg pool
```

Key modules: `auth`, `registro`, `usuarios`, `productos`, `inventario`, `facturas`, `caja`, `creditos`, `prestamos`, `reportes`, `sucursales`, `superadmin`, `tesoreria`.

> **Tesorería**: los saldos por cuenta (efectivo/banco/billetera/corresponsal) se **derivan** de las tablas transaccionales existentes mapeando método de pago → cuenta, anclados en arqueos. Solo traslados/retiros/gastos se escriben en `movimientos_dinero`. Si cambian las reglas de qué entra/sale en `caja.repository.js`, replicarlas en `tesoreria.repository.js` (ramas marcadas). Los movimientos de efectivo se espejan en `movimientos_caja` con `referencia_tipo='tesoreria'`.

### Frontend API Layer

Each feature has a dedicated Axios client file in `frontend/src/api/` (e.g., `productosApi.js`, `facturasApi.js`). These files are the only place that constructs request URLs — components and hooks should never call `axios` directly.

State is split between:
- **Zustand stores** (`carritoStore`, `sucursalStore`) for UI/session state.
- **React Query** for server state and caching.
- **AuthContext** for the authenticated user/session.

### Route Protection

`PrivateRoute` in `frontend/src/components/Layout/` enforces authentication. `ModuloGuard` enforces plan-level feature permissions (some modules are locked behind Premium/Monthly plans).

### PWA Caching Strategy

Routes under `/api/reportes` and `/api/facturas` use **NetworkOnly** (always fresh). Other API routes cache responses for 5 minutes. This is configured in the Vite PWA plugin settings.

### Database

- PostgreSQL, timezone forced to `America/Bogota`.
- Schema source of truth: `schema_v2.sql` at the project root.
- Billing states: `trial`, `mensual`, `premium`, `vencido`, `suspendido`.
- A separate `superadmin` table exists for platform owners (distinct from `admin_negocio`).

---

## Deployment

| Layer    | Platform | Notes |
|----------|----------|-------|
| Backend  | Railway  | `VITE_API_URL` in frontend points here |
| Frontend | Vercel   | SPA rewrite configured in `vercel.json` |
| DB       | PostgreSQL (Railway) | |

### Required Backend Environment Variables
```
DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD
JWT_SECRET, JWT_REFRESH_SECRET, JWT_SA_SECRET
PORT, NODE_ENV, FRONTEND_URL
EMAIL_USER, EMAIL_PASS
```

---

## Key Conventions

- **Rate limiting**: 60 req/min on all `/api/` routes except `/health`.
- **CORS**: Strict whitelist — `FRONTEND_URL` env var + `localhost:5173`.
- **Excel**: Inventory/product imports handled via `multer` + `xlsx` on the backend; frontend also exports Excel directly.
- **PDF**: Generated server-side with `pdfkit`.
- **Email**: Multiple providers in use — Nodemailer (Gmail), Brevo SDK, and Resend — configured per environment.
- **Backup**: Automated cron jobs via `node-cron` in the `backup` module.
- **Superadmin JWT**: Uses a separate secret (`JWT_SA_SECRET`) and separate middleware from regular user auth.
