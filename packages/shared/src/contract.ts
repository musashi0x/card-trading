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

export class MarketplaceContract {
  private readonly contract: Contract;

  constructor(contractId: string) {
    this.contract = new Contract(contractId);
  }

  /** init(admin, platform, usdc_token, fee_bps) — one-time setup. */
  init(admin: string, platform: string, usdcToken: string, feeBps: number): xdr.Operation {
    return this.contract.call('init', addr(admin), addr(platform), addr(usdcToken), u32(feeBps));
  }

  /** list(seller, card_token, price) -> listing_id. Locks the card. */
  list(seller: string, cardToken: string, priceStroops: bigint): xdr.Operation {
    return this.contract.call('list', addr(seller), addr(cardToken), i128(priceStroops));
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

  /** buy_now(buyer, listing_id). Atomic settlement at asking price. */
  buyNow(buyer: string, listingId: number): xdr.Operation {
    return this.contract.call('buy_now', addr(buyer), u32(listingId));
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
