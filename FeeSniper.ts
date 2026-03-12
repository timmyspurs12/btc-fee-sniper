import {
    Address,
    Blockchain,
    BytesWriter,
    Calldata,
    encodeSelector,
    Map,
    OP_20,
    Revert,
    SafeMath,
    Selector,
    StoredU256,
    StoredString,
    u256,
} from "@btc-vision/btc-runtime/runtime";

/**
 * FeeSniper — OPNet Smart Contract
 *
 * Users register a target fee (sat/vB) alongside a pre-signed transaction hex.
 * The contract stores registrations on-chain and emits events when a fee window
 * opens so off-chain relayers (or the user's own client) can act.
 *
 * Selectors (first 4 bytes of keccak256 of signature):
 *   register(uint256 targetFee, string txHex)
 *   cancel()
 *   getRegistration(address user) → (uint256 targetFee, string txHex, bool active)
 *   reportFee(uint256 currentFee)   ← called by trusted oracle / owner
 *   getLastFee() → uint256
 *   owner() → address
 */

@final
export class FeeSniper extends OP_20 {
    // ── Storage slots ─────────────────────────────────────────────────────────
    private readonly SLOT_LAST_FEE: u16 = 100;
    private readonly SLOT_OWNER: u16 = 101;

    // Per-user storage: packed as slot = hash(userAddress, field)
    // field 0 = targetFee, field 1 = txHex, field 2 = active flag

    // ── Selectors ─────────────────────────────────────────────────────────────
    private readonly SEL_REGISTER: Selector = encodeSelector(
        "register(uint256,string)"
    );
    private readonly SEL_CANCEL: Selector = encodeSelector("cancel()");
    private readonly SEL_GET_REG: Selector = encodeSelector(
        "getRegistration(address)"
    );
    private readonly SEL_REPORT_FEE: Selector = encodeSelector(
        "reportFee(uint256)"
    );
    private readonly SEL_GET_LAST_FEE: Selector =
        encodeSelector("getLastFee()");
    private readonly SEL_OWNER: Selector = encodeSelector("owner()");

    constructor() {
        super();
    }

    // ── Router ────────────────────────────────────────────────────────────────
    public override callMethod(
        method: Selector,
        calldata: Calldata
    ): BytesWriter {
        switch (method) {
            case this.SEL_REGISTER:
                return this.register(calldata);
            case this.SEL_CANCEL:
                return this.cancel();
            case this.SEL_GET_REG:
                return this.getRegistration(calldata);
            case this.SEL_REPORT_FEE:
                return this.reportFee(calldata);
            case this.SEL_GET_LAST_FEE:
                return this.getLastFee();
            case this.SEL_OWNER:
                return this.getOwner();
            default:
                throw new Revert("Unknown method");
        }
    }

    // ── register(uint256 targetFee, string txHex) ─────────────────────────────
    private register(calldata: Calldata): BytesWriter {
        const targetFee = calldata.readU256();
        const txHex = calldata.readStringWithLength();

        if (targetFee == u256.Zero) throw new Revert("Target fee must be > 0");
        if (txHex.length == 0) throw new Revert("txHex cannot be empty");
        if (txHex.length > 50000) throw new Revert("txHex too long");

        const caller = Blockchain.callerAddress;

        // Store targetFee
        const feeSlot = this._userSlot(caller, 0);
        Blockchain.setStorageAt(feeSlot, targetFee);

        // Store txHex length + data (simple encoding)
        const hexSlot = this._userSlot(caller, 1);
        const hexBytes = String.UTF8.encode(txHex);
        // Store length
        Blockchain.setStorageAt(hexSlot, u256.fromU32(hexBytes.byteLength));
        // Store data chunks (32 bytes each)
        for (let i = 0; i < hexBytes.byteLength; i += 32) {
            const chunk = this._readChunk(hexBytes, i);
            Blockchain.setStorageAt(this._userSlot(caller, 2 + (i >> 5)), chunk);
        }

        // Mark active
        const activeSlot = this._userSlot(caller, 200);
        Blockchain.setStorageAt(activeSlot, u256.fromU32(1));

        // Emit FeeRegistered event
        const writer = new BytesWriter(32 + 32);
        writer.writeAddress(caller);
        writer.writeU256(targetFee);
        Blockchain.emit("FeeRegistered", writer);

        // Check immediately if current fee already meets target
        const lastFee = this._loadU256(this.SLOT_LAST_FEE);
        if (lastFee != u256.Zero && lastFee <= targetFee) {
            this._emitWindowOpen(caller, targetFee, lastFee);
        }

        const resp = new BytesWriter(1);
        resp.writeBoolean(true);
        return resp;
    }

    // ── cancel() ──────────────────────────────────────────────────────────────
    private cancel(): BytesWriter {
        const caller = Blockchain.callerAddress;
        const activeSlot = this._userSlot(caller, 200);
        Blockchain.setStorageAt(activeSlot, u256.Zero);

        const resp = new BytesWriter(1);
        resp.writeBoolean(true);
        return resp;
    }

    // ── getRegistration(address) ──────────────────────────────────────────────
    private getRegistration(calldata: Calldata): BytesWriter {
        const user = calldata.readAddress();
        const targetFee = Blockchain.getStorageAt(this._userSlot(user, 0), u256.Zero);
        const active =
            Blockchain.getStorageAt(this._userSlot(user, 200), u256.Zero) ==
            u256.fromU32(1);

        const resp = new BytesWriter(32 + 1);
        resp.writeU256(targetFee);
        resp.writeBoolean(active);
        return resp;
    }

    // ── reportFee(uint256) — called by trusted oracle ─────────────────────────
    private reportFee(calldata: Calldata): BytesWriter {
        // Only owner can report fees
        const owner = this._loadAddress(this.SLOT_OWNER);
        if (Blockchain.callerAddress != owner) {
            throw new Revert("Only owner can report fees");
        }

        const fee = calldata.readU256();
        Blockchain.setStorageAt(u256.fromU16(this.SLOT_LAST_FEE), fee);

        // Emit global FeeUpdate
        const updateWriter = new BytesWriter(32);
        updateWriter.writeU256(fee);
        Blockchain.emit("FeeUpdate", updateWriter);

        const resp = new BytesWriter(1);
        resp.writeBoolean(true);
        return resp;
    }

    // ── getLastFee() ──────────────────────────────────────────────────────────
    private getLastFee(): BytesWriter {
        const fee = this._loadU256(this.SLOT_LAST_FEE);
        const resp = new BytesWriter(32);
        resp.writeU256(fee);
        return resp;
    }

    // ── owner() ───────────────────────────────────────────────────────────────
    private getOwner(): BytesWriter {
        const owner = this._loadAddress(this.SLOT_OWNER);
        const resp = new BytesWriter(32);
        resp.writeAddress(owner);
        return resp;
    }

    // ── Helpers ───────────────────────────────────────────────────────────────
    private _emitWindowOpen(
        user: Address,
        targetFee: u256,
        currentFee: u256
    ): void {
        const w = new BytesWriter(32 + 32 + 32);
        w.writeAddress(user);
        w.writeU256(targetFee);
        w.writeU256(currentFee);
        Blockchain.emit("WindowOpen", w);
    }

    private _userSlot(user: Address, field: u32): u256 {
        // Simple slot derivation: keccak256(user ++ field) — OPNet handles storage isolation
        const w = new BytesWriter(32 + 4);
        w.writeAddress(user);
        w.writeU32(field);
        return Blockchain.keccak256(w.getBuffer());
    }

    private _loadU256(slot: u16): u256 {
        return Blockchain.getStorageAt(u256.fromU16(slot), u256.Zero);
    }

    private _loadAddress(slot: u16): Address {
        const raw = Blockchain.getStorageAt(u256.fromU16(slot), u256.Zero);
        return Address.fromU256(raw);
    }

    private _readChunk(buf: ArrayBuffer, offset: i32): u256 {
        const view = new DataView(buf);
        const bytes = new Uint8Array(32);
        const remaining = buf.byteLength - offset;
        const len = remaining < 32 ? remaining : 32;
        for (let i = 0; i < len; i++) {
            bytes[i] = view.getUint8(offset + i);
        }
        return u256.fromBytes(bytes);
    }

    // ── Called on first deploy to set owner ───────────────────────────────────
    public override onDeploy(calldata: Calldata): void {
        Blockchain.setStorageAt(
            u256.fromU16(this.SLOT_OWNER),
            u256.fromAddress(Blockchain.callerAddress)
        );
    }
}
