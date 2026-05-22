# Test actors (Preprod) — FIXED

This is the **stable** set of test identities. Do not regenerate. Seeds are in
`tools/persona-wallets.json` (gitignored, local only). Import each 24-word seed as
a **separate** wallet in Lace/Eternl (choose **24-word** recovery), network = **Preprod**.

| Actor | Platform role | Login |
|---|---|---|
| **Admin** | Platform Admin (operational) | `/admin/login` · username `satucha` (dev password set via `pnpm admin:create`) |
| **Board DRep** | DRep + Board member | wallet (seeded into genesis) |
| **Regular DRep** | DRep | wallet (admitted by board) |
| **ADA holder** | Viewer + Submitter | wallet |

## Addresses

**Board DRep**
- stake: `stake_test1urqn2e07tp6qa556rjc2pskxdlh7xhwxsushx5ug53xjevsan47jx`
- payment (fund here): `addr_test1qpdx47kyzpk5hxydx96mw2mf3zcpehx7rzq827yfsj0e66xpx4jlukr5pmff589s5rpvvml0udwudpepwdfc3fzd9jeqpxgc66`
- drep_id (derived): `drep1m4cp25wntmr7afs85cmk3kgq2cdknk9e89nscd4pkuy6523mw7m`

**Regular DRep**
- stake: `stake_test1upn85fz4mdst939ymhfrgtppgc74tfr9mhwyp8u6vpxa7pgrtye29`
- payment (fund here): `addr_test1qp77m2c97pl05yynuua3022r8j302v23q90fkv8p0e4p0vtx0gj9tkmqktz2fhwjxskzz33a2kjxthwugz0e5czdmuzsjyk5u3`
- drep_id (derived): `drep1j38k0nlvcsu3pmdkgma3c85dr689ft2cmv2qtjx9zfags524kuf`

**ADA holder** (no DRep, no funding needed)
- stake: `stake_test1urqw60ntj3v8pwxr7veg7wnncn4anjlzx0geg9dl3536khg6j0ttd`
- payment: `addr_test1qrzrxcfefv7wyrrxch2gfrvu3lvcz65r04c7fzdqpt8s8nxqa5lxh9zcwzuv8uej3ua8838tm897yv73js2mlrfr4dws47c726`

## On-chain DRep registration (optional)

The platform grants DRep status through admin-confirmed genesis (Board DRep) and
board admission (Regular DRep) — keyed to the **stake key**. On-chain DRep
registration (500 tADA refundable deposit) makes them *real Cardano DReps* and is
required only for future Blockfrost verification. To register: fund the two DRep
**payment** addresses from the Preprod faucet, then either register in
Eternl/Lace (Governance → Register as a DRep) or have the registration certs
submitted from the seeds.
