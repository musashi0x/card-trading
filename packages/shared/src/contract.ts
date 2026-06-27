/**
 * Builders for marketplace settlement-contract invocations.
 *
 * Each function returns an unprepared contract-call operation. The API
 * simulates + assembles it against Soroban RPC, then hands the resulting
 * unsigned XDR to the wallet. The arg shapes mirror the Rust contract.
 */

import { Address, Contract, nativeToScVal, type xdr } from '@stellar/stellar-sdk';

function addr(account: string): xdr.ScVal {
  return new Address(account).toScVal();
}

function i128(value: bigint): xdr.ScVal {
  return nativeToScVal(value, { type: 'i128' });
}

function u32(value: number): xdr.ScVal {
  return nativeToScVal(value, { type: 'u32' });
}

function bool(value: boolean): xdr.ScVal {
  return nativeToScVal(value, { type: 'bool' });
}

/** Listing fulfillment modes; mirror the `FULFILL_*` constants in the contract. */
export const FULFILLMENT = { digital: 0, physical: 1 } as const;
export type FulfillmentMode = keyof typeof FULFILLMENT;

export class MarketplaceContract {
  private readonly contract: Contract;

  constructor(contractId: string) {
    this.contract = new Contract(contractId);
  }

  /** init(admin, platform, arbiter, usdc_token, fee_bps, max_royalty_bps) — one-time setup. */
  init(
    admin: string,
    platform: string,
    arbiter: string,
    usdcToken: string,
    feeBps: number,
    maxRoyaltyBps: number,
  ): xdr.Operation {
    return this.contract.call(
      'init',
      addr(admin),
      addr(platform),
      addr(arbiter),
      addr(usdcToken),
      u32(feeBps),
      u32(maxRoyaltyBps),
    );
  }

  /** set_arbiter(arbiter) — admin re-points the dispute arbiter. */
  setArbiter(arbiter: string): xdr.Operation {
    return this.contract.call('set_arbiter', addr(arbiter));
  }

  /** set_paused(paused) — admin toggles the circuit breaker. */
  setPaused(paused: boolean): xdr.Operation {
    return this.contract.call('set_paused', bool(paused));
  }

  /** set_royalty(card_token, creator, royalty_bps) — admin registers a card's creator royalty. */
  setRoyalty(cardToken: string, creator: string, royaltyBps: number): xdr.Operation {
    return this.contract.call('set_royalty', addr(cardToken), addr(creator), u32(royaltyBps));
  }

  /** get_royalty_view(card_token) -> RoyaltyConfig — read-only, for catalog/pre-flight. */
  getRoyaltyView(cardToken: string): xdr.Operation {
    return this.contract.call('get_royalty_view', addr(cardToken));
  }

  /** list(seller, card_token, price, fulfillment) -> listing_id. Locks the card. */
  list(
    seller: string,
    cardToken: string,
    priceStroops: bigint,
    fulfillment: number = FULFILLMENT.digital,
  ): xdr.Operation {
    return this.contract.call(
      'list',
      addr(seller),
      addr(cardToken),
      i128(priceStroops),
      u32(fulfillment),
    );
  }

  /** cancel_listing(seller, listing_id). Returns the escrowed card. */
  cancelListing(seller: string, listingId: number): xdr.Operation {
    return this.contract.call('cancel_listing', addr(seller), u32(listingId));
  }

  /** make_offer(buyer, listing_id, amount) -> offer_id. Locks the USDC. */
  makeOffer(buyer: string, listingId: number, amountStroops: bigint): xdr.Operation {
    return this.contract.call('make_offer', addr(buyer), u32(listingId), i128(amountStroops));
  }

  /** withdraw_offer(buyer, offer_id). Returns escrowed USDC if not accepted. */
  withdrawOffer(buyer: string, offerId: number): xdr.Operation {
    return this.contract.call('withdraw_offer', addr(buyer), u32(offerId));
  }

  /** accept_offer(seller, offer_id). Atomic settlement. */
  acceptOffer(seller: string, offerId: number): xdr.Operation {
    return this.contract.call('accept_offer', addr(seller), u32(offerId));
  }

  /** buy_now(buyer, listing_id). Atomic settlement at asking price (digital). */
  buyNow(buyer: string, listingId: number): xdr.Operation {
    return this.contract.call('buy_now', addr(buyer), u32(listingId));
  }

  // --- physical escrow ---

  /** purchase_escrow(buyer, listing_id) -> order_id. Locks USDC; holds the card. */
  purchaseEscrow(buyer: string, listingId: number): xdr.Operation {
    return this.contract.call('purchase_escrow', addr(buyer), u32(listingId));
  }

  /** mark_shipped(seller, order_id). Seller signals dispatch; resets the window. */
  markShipped(seller: string, orderId: number): xdr.Operation {
    return this.contract.call('mark_shipped', addr(seller), u32(orderId));
  }

  /** confirm_receipt(buyer, order_id). Releases funds to seller + card to buyer. */
  confirmReceipt(buyer: string, orderId: number): xdr.Operation {
    return this.contract.call('confirm_receipt', addr(buyer), u32(orderId));
  }

  /** claim_timeout(order_id). Permissionless release to seller after the window. */
  claimTimeout(orderId: number): xdr.Operation {
    return this.contract.call('claim_timeout', u32(orderId));
  }

  /** dispute(caller, order_id). Buyer or seller freezes the order for the arbiter. */
  dispute(caller: string, orderId: number): xdr.Operation {
    return this.contract.call('dispute', addr(caller), u32(orderId));
  }

  /** resolve(order_id, refund). Arbiter refunds the buyer (true) or releases the seller (false). */
  resolve(orderId: number, refund: boolean): xdr.Operation {
    return this.contract.call('resolve', u32(orderId), bool(refund));
  }

  /** get_order_view(order_id) — read-only, for the indexer. */
  getOrderView(orderId: number): xdr.Operation {
    return this.contract.call('get_order_view', u32(orderId));
  }

  /** get_listing_view(listing_id) — read-only, for the indexer. */
  getListingView(listingId: number): xdr.Operation {
    return this.contract.call('get_listing_view', u32(listingId));
  }

  /** get_offer_view(offer_id) — read-only, for the indexer. */
  getOfferView(offerId: number): xdr.Operation {
    return this.contract.call('get_offer_view', u32(offerId));
  }
}
