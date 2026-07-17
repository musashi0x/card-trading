/**
 * Builders for marketplace settlement-contract invocations.
 *
 * Each function returns an unprepared contract-call operation. The API
 * simulates + assembles it against Soroban RPC, then hands the resulting
 * unsigned XDR to the wallet. The arg shapes mirror the Rust contract.
 */

import { Address, Contract, nativeToScVal, xdr } from '@stellar/stellar-sdk';

function addr(account: string): xdr.ScVal {
  return new Address(account).toScVal();
}

/** A Soroban `Vec<u32>` from a list of collection token ids. */
function u32Vec(tokenIds: number[]): xdr.ScVal {
  return xdr.ScVal.scvVec(tokenIds.map(u32));
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

function u64(value: bigint | number): xdr.ScVal {
  return nativeToScVal(BigInt(value), { type: 'u64' });
}

/** Listing fulfillment modes; mirror the `FULFILL_*` constants in the contract. */
export const FULFILLMENT = { digital: 0, physical: 1 } as const;
export type FulfillmentMode = keyof typeof FULFILLMENT;

export class MarketplaceContract {
  private readonly contract: Contract;

  constructor(contractId: string) {
    this.contract = new Contract(contractId);
  }

  /** init(admin, platform, arbiter, usdc_token, fee_bps, max_royalty_bps, collection) — one-time setup. */
  init(
    admin: string,
    platform: string,
    arbiter: string,
    usdcToken: string,
    feeBps: number,
    maxRoyaltyBps: number,
    collection: string,
  ): xdr.Operation {
    return this.contract.call(
      'init',
      addr(admin),
      addr(platform),
      addr(arbiter),
      addr(usdcToken),
      u32(feeBps),
      u32(maxRoyaltyBps),
      addr(collection),
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

  /** list(seller, token_id, price, fulfillment) -> listing_id. Locks the card copy. */
  list(
    seller: string,
    tokenId: number,
    priceStroops: bigint,
    fulfillment: number = FULFILLMENT.digital,
  ): xdr.Operation {
    return this.contract.call(
      'list',
      addr(seller),
      u32(tokenId),
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

  // --- timed auctions ---

  /**
   * create_auction(seller, token_id, start_price, reserve_price, duration) -> auction_id.
   * Escrows the card copy and opens a timed auction.
   */
  createAuction(
    seller: string,
    tokenId: number,
    startPriceStroops: bigint,
    reservePriceStroops: bigint,
    durationSecs: number,
  ): xdr.Operation {
    return this.contract.call(
      'create_auction',
      addr(seller),
      u32(tokenId),
      i128(startPriceStroops),
      i128(reservePriceStroops),
      u64(durationSecs),
    );
  }

  /** place_bid(bidder, auction_id, amount). Escrows USDC; refunds the previous high bidder. */
  placeBid(bidder: string, auctionId: number, amountStroops: bigint): xdr.Operation {
    return this.contract.call('place_bid', addr(bidder), u32(auctionId), i128(amountStroops));
  }

  /** settle_auction(auction_id). Permissionless once `ends_at` has passed. */
  settleAuction(auctionId: number): xdr.Operation {
    return this.contract.call('settle_auction', u32(auctionId));
  }

  /** cancel_auction(seller, auction_id). Seller reclaims a no-bid auction. */
  cancelAuction(seller: string, auctionId: number): xdr.Operation {
    return this.contract.call('cancel_auction', addr(seller), u32(auctionId));
  }

  /** claim_refund(bidder, auction_id). Safety valve to withdraw a stuck refund. */
  claimRefund(bidder: string, auctionId: number): xdr.Operation {
    return this.contract.call('claim_refund', addr(bidder), u32(auctionId));
  }

  /** get_auction_view(auction_id) — read-only, for the indexer. */
  getAuctionView(auctionId: number): xdr.Operation {
    return this.contract.call('get_auction_view', u32(auctionId));
  }

  // --- barter swap ---

  /**
   * propose_swap(proposer, counterparty, give_token_ids[], get_token_ids[], usdc_amount) -> proposal_id.
   * Locks the proposer's give-side card copies (and any USDC sweetener) into custody.
   */
  proposeSwap(
    proposer: string,
    counterparty: string,
    giveTokenIds: number[],
    getTokenIds: number[],
    usdcAmountStroops: bigint,
  ): xdr.Operation {
    return this.contract.call(
      'propose_swap',
      addr(proposer),
      addr(counterparty),
      u32Vec(giveTokenIds),
      u32Vec(getTokenIds),
      i128(usdcAmountStroops),
    );
  }

  /** execute_swap(counterparty, proposal_id). Atomic both-sided settlement. */
  executeSwap(counterparty: string, proposalId: number): xdr.Operation {
    return this.contract.call('execute_swap', addr(counterparty), u32(proposalId));
  }

  /** cancel_swap(proposer, proposal_id). Returns the proposer's locked assets. */
  cancelSwap(proposer: string, proposalId: number): xdr.Operation {
    return this.contract.call('cancel_swap', addr(proposer), u32(proposalId));
  }

  /** decline_swap(counterparty, proposal_id). Returns the proposer's locked assets. */
  declineSwap(counterparty: string, proposalId: number): xdr.Operation {
    return this.contract.call('decline_swap', addr(counterparty), u32(proposalId));
  }

  /** get_swap_view(proposal_id) — read-only, for the indexer. */
  getSwapView(proposalId: number): xdr.Operation {
    return this.contract.call('get_swap_view', u32(proposalId));
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

/**
 * Builders for the global card-collection (NFT) contract. Minting is
 * restricted to the platform owner account and is signed server-side; the
 * views back ownership preflights and the indexer.
 */
export class CardCollection {
  private readonly contract: Contract;

  constructor(contractId: string) {
    this.contract = new Contract(contractId);
  }

  /** mint(to, creator, royalty_bps) -> token_id. Owner-only, server-signed. */
  mint(to: string, creator: string, royaltyBps: number): xdr.Operation {
    return this.contract.call('mint', addr(to), addr(creator), u32(royaltyBps));
  }

  /** owner_of(token_id) -> Address — read-only ownership preflight. */
  ownerOf(tokenId: number): xdr.Operation {
    return this.contract.call('owner_of', u32(tokenId));
  }

  /** balance(account) -> u32 — read-only copy count for a wallet. */
  balance(account: string): xdr.Operation {
    return this.contract.call('balance', addr(account));
  }

  /** token_royalty(token_id) -> (receiver, bps) — read-only; bps 0 means no royalty. */
  tokenRoyalty(tokenId: number): xdr.Operation {
    return this.contract.call('token_royalty', u32(tokenId));
  }
}
