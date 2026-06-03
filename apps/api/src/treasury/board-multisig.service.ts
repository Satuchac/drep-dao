import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as CSL from '@emurgo/cardano-serialization-lib-nodejs';
import { PrismaService } from '../prisma/prisma.service';
import { verifyCip30Signature } from '../auth/cip30';

/**
 * §15 — board multisig setup.
 *
 * Each of the N board seats submits ONE payment verification-key
 * (typically from a hardware wallet). The board member attests via a CIP-30
 * data-signature proving they actually control that key (we sign a canonical
 * challenge with the wallet that holds the multisig key — usually a DIFFERENT
 * wallet from the one used for the DRep identity).
 *
 * Once every seat has submitted, the platform auto-assembles a Cardano
 * native script of shape `{type:atLeast, required:3, scripts:[{sig keyhash}*N]}`,
 * derives its script hash + bech32 enterprise address, and stores both in
 * `MultisigConfig`. Treasury / fee / pledge code switches over to this
 * address as the on-chain home (handled in Phase 3).
 */
@Injectable()
export class BoardMultisigService {
  private readonly networkId: number;
  private readonly threshold = 3; // 3-of-N for the time being

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    const net = (this.config.get<string>('CARDANO_NETWORK') ?? 'Preprod').trim();
    this.networkId = net === 'Mainnet' ? 1 : 0;
  }

  /** Canonical challenge message the wallet signs to prove possession of
   *  the multisig payment key. Includes the user's stake address (binding
   *  to their seat) + the payment bech32 + the timestamp to prevent reuse. */
  static attestationMessage(args: { stakeAddress: string; paymentBech32: string; ts: string }): string {
    return [
      'drep-dao | multisig key attestation',
      `seat:${args.stakeAddress}`,
      `pay:${args.paymentBech32}`,
      `ts:${args.ts}`,
    ].join('\n');
  }

  /** Public — the active multisig (or null if not yet assembled). */
  async active() {
    return this.prisma.multisigConfig.findFirst({ orderBy: { assembledAt: 'desc' } });
  }

  /**
   * Public — who's submitted what, and what the active multisig is. Drives
   * the Treasury "Multisig setup" panel + the Actions card on each board
   * member's dashboard.
   */
  async status() {
    const [seats, active, keys] = await Promise.all([
      this.prisma.boardSeat.findMany({ orderBy: { addedAt: 'asc' } }),
      this.active(),
      this.prisma.boardMultisigKey.findMany({ include: { user: { select: { displayName: true, stakeAddress: true } } } }),
    ]);
    const byUserId = new Map(keys.map((k) => [k.userId, k]));
    const bySeatId = new Map(keys.map((k) => [k.boardSeatId, k]));
    const rows = await Promise.all(seats.map(async (s) => {
      const linked = await this.prisma.appUser.findFirst({ where: { drepKeyHash: s.drepKeyHash } }).catch(() => null);
      const key = (linked ? byUserId.get(linked.id) : null) ?? bySeatId.get(s.id) ?? null;
      return {
        seatId: s.id,
        drepId: s.drepId,
        drepKeyHash: s.drepKeyHash,
        displayName: s.displayName,
        userId: linked?.id ?? null,
        hasKey: !!key,
        keyHash: key?.paymentKeyHash ?? null,
        paymentBech32: key?.paymentBech32 ?? null,
        hardwareAttested: key?.hardwareAttested ?? false,
        submittedAt: key?.submittedAt ?? null,
      };
    }));
    const submitted = rows.filter((r) => r.hasKey).length;
    return {
      threshold: this.threshold,
      total: seats.length,
      submitted,
      ready: submitted === seats.length && seats.length > 0,
      active: active
        ? {
            scriptHash: active.scriptHash,
            bech32Address: active.bech32Address,
            threshold: active.threshold,
            totalKeys: active.totalKeys,
            assembledAt: active.assembledAt,
          }
        : null,
      seats: rows,
    };
  }

  /**
   * Board member submits THEIR signing key. We:
   *   - extract the 28-byte payment key hash from the bech32 address;
   *   - reject script-credential addresses (must be a key-credential address);
   *   - verify the CIP-30 signature was made with that address (proof of
   *     possession of the private key);
   *   - upsert the key (one per seat);
   *   - if every seat now has a key, auto-assemble the multisig.
   */
  async submitKey(userId: string, dto: {
    paymentBech32: string;
    hardwareAttested: boolean;
    signature: string;
    key: string;
    ts: string;
  }) {
    const user = await this.prisma.appUser.findUnique({
      where: { id: userId },
      select: { id: true, stakeAddress: true, drepKeyHash: true },
    });
    if (!user?.drepKeyHash) throw new ForbiddenException('board members only');
    const seat = await this.prisma.boardSeat.findUnique({ where: { drepKeyHash: user.drepKeyHash } });
    if (!seat) throw new ForbiddenException('not a board seat');

    const bech = dto.paymentBech32.trim();
    if (!bech || !bech.startsWith('addr')) {
      throw new BadRequestException('paymentBech32 must be a Cardano payment address (addr… / addr_test…)');
    }
    let addr: CSL.Address;
    try {
      addr = CSL.Address.from_bech32(bech);
    } catch {
      throw new BadRequestException('paymentBech32 is not a valid Cardano address');
    }
    const expectedNet = this.networkId;
    if (addr.network_id() !== expectedNet) {
      throw new BadRequestException(`address is on the wrong network (need ${expectedNet === 1 ? 'Mainnet' : 'Preprod/testnet'})`);
    }
    const baseAddr = CSL.BaseAddress.from_address(addr);
    const entAddr = CSL.EnterpriseAddress.from_address(addr);
    const cred = baseAddr?.payment_cred() ?? entAddr?.payment_cred() ?? null;
    if (!cred) throw new BadRequestException('only base/enterprise addresses are accepted');
    const keyHashObj = cred.to_keyhash();
    if (!keyHashObj) {
      throw new BadRequestException('the address uses a script credential — submit a key-based address (HW wallets always provide one)');
    }
    const paymentKeyHash = keyHashObj.to_hex();

    // CIP-30 proof of possession. We verify the signature against the
    // submitted payment address — the underlying library checks that the
    // COSE_Key embedded in the signature resolves to that address's
    // credential, which is exactly "this wallet controls that key".
    const message = BoardMultisigService.attestationMessage({
      stakeAddress: user.stakeAddress,
      paymentBech32: bech,
      ts: dto.ts,
    });
    if (!verifyCip30Signature(dto.signature, dto.key, message, bech)) {
      throw new BadRequestException(
        'signature did not verify against the submitted address — sign the message with the wallet that holds the multisig key',
      );
    }

    // Conflict: the same payment key already claimed by another seat.
    const dup = await this.prisma.boardMultisigKey.findFirst({ where: { paymentKeyHash, boardSeatId: { not: seat.id } } });
    if (dup) throw new ConflictException('that payment key is already used by another board seat');

    await this.prisma.boardMultisigKey.upsert({
      where: { boardSeatId: seat.id },
      update: {
        userId,
        paymentKeyHash,
        paymentBech32: bech,
        hardwareAttested: !!dto.hardwareAttested,
        attestationSignature: dto.signature,
        attestationKey: dto.key,
        attestationTs: dto.ts,
        submittedAt: new Date(),
      },
      create: {
        boardSeatId: seat.id,
        userId,
        paymentKeyHash,
        paymentBech32: bech,
        hardwareAttested: !!dto.hardwareAttested,
        attestationSignature: dto.signature,
        attestationKey: dto.key,
        attestationTs: dto.ts,
      },
    });

    await this.tryAssemble();
    return this.status();
  }

  /**
   * Auto-assemble the native script + derive its address once every seat
   * has a key. Idempotent: if the active script hash already matches what
   * we'd assemble now, do nothing (e.g. resubmitting the same key triggers
   * status() but no new config row).
   */
  private async tryAssemble() {
    const seats = await this.prisma.boardSeat.findMany({ include: { multisigKey: true }, orderBy: { addedAt: 'asc' } });
    if (seats.length === 0) return null;
    if (seats.some((s) => !s.multisigKey)) return null;

    // Sort by key hash for a canonical script: same set of keys → same hash
    // → same address, regardless of submission order.
    const keyHashes = seats.map((s) => s.multisigKey!.paymentKeyHash.toLowerCase()).sort();
    const required = Math.min(this.threshold, keyHashes.length);

    const scripts = CSL.NativeScripts.new();
    for (const kh of keyHashes) {
      const ed = CSL.Ed25519KeyHash.from_hex(kh);
      scripts.add(CSL.NativeScript.new_script_pubkey(CSL.ScriptPubkey.new(ed)));
    }
    const nofk = CSL.ScriptNOfK.new(required, scripts);
    const top = CSL.NativeScript.new_script_n_of_k(nofk);
    const scriptHashObj = top.hash();
    const scriptHash = scriptHashObj.to_hex();
    const bech32Address = CSL.EnterpriseAddress.new(
      this.networkId,
      CSL.Credential.from_scripthash(scriptHashObj),
    ).to_address().to_bech32();
    const scriptJson = {
      type: 'atLeast' as const,
      required,
      scripts: keyHashes.map((keyHash) => ({ type: 'sig' as const, keyHash })),
    };

    const last = await this.active();
    if (last && last.scriptHash === scriptHash) return last;
    return this.prisma.multisigConfig.create({
      data: { scriptJson, scriptHash, bech32Address, threshold: required, totalKeys: keyHashes.length },
    });
  }
}
