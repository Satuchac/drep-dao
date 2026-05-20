# DRep DAO

A self-hosted web platform for a Cardano governance DAO: DReps collectively review
funding proposals in Catalyst-style rounds, run internal governance votes, manage a
3-of-5 native multisig treasury, and pay rewards. The backend + Postgres are the
**source of truth**; the chain is used for wallet auth (CIP-30/CIP-8), DRep identity
(CIP-95), the multisig treasury, fee/pledge verification, and daily Merkle-hash
**anchoring** for independent verifiability. There is **no Plutus/Aiken on-chain logic**
(see design §21.2).

Full design: [docs/DESIGN.md](docs/DESIGN.md).

## Architecture

```
drep-dao/
├── apps/
│   ├── web/        Next.js 15 + React 19 frontend (MeshJS wallet integration)
│   └── api/        NestJS backend — REST API, jobs, source of truth
├── packages/
│   ├── shared/     Shared types, enums, status/role constants, config defaults
│   ├── cardano/    Cardano integration (CardanoQueryService, Lucid wrappers, anchoring)
│   └── db/         Prisma schema, migrations, seed data
├── infra/          docker-compose for local Postgres + Redis
└── docs/           Design document + ADRs
```

Monorepo: **pnpm workspaces + Turborepo**. Stack per design §21.

## Prerequisites

- Node.js >= 20 (this repo is developed on 24)
- pnpm 9 (`corepack enable pnpm`)
- Docker + Docker Compose, for local Postgres 16 + Redis 7
  - On WSL2: install **Docker Desktop** and enable WSL integration for this distro
    (Settings → Resources → WSL integration), or install the docker engine inside WSL.

## Getting started

```bash
# 1. Install dependencies
pnpm install

# 2. Configure environment
cp .env.example .env          # edit secrets as needed

# 3. Start local Postgres + Redis
pnpm infra:up                 # docker compose up -d (needs Docker running)

# 4. Create the database schema and seed defaults
pnpm db:generate              # generate the Prisma client
pnpm db:migrate               # apply migrations (needs the DB running)
pnpm db:seed                  # seed platform_config + subcategories

# 5. Run everything in dev
pnpm dev                      # web on :3000, api on :4000
```

Health check: `curl http://localhost:4000/internal/healthz`.

## Delivery phases

This repo follows the phased MVP cut in design §27. Current status: **scaffold + running
skeleton**. Next vertical slice (§28.5): wallet login → DRep admission → admin rounds UI.
