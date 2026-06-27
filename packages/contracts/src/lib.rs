#![no_std]
//! Marketplace settlement contract.
//!
//! Two settlement paths share one "lock asset until condition" escrow primitive:
//!
//! Digital cards settle atomically — the moment USDC moves, the card token moves
//! in the same transaction, so neither side can be cheated:
//!   - `list`           seller locks a card into contract custody
//!   - `make_offer`     buyer locks USDC into contract custody
//!   - `accept_offer`   atomic settlement: card -> buyer, USDC-fee -> seller, fee -> platform
//!   - `buy_now`        same settlement at the asking price
//!   - `cancel_listing` / `withdraw_offer` return escrowed value to its owner
//!
//! Physical cards ship in the real world, so atomic delivery is impossible. They
//! settle through a held escrow with delivery confirmation, a timeout, and an
//! arbiter, guarding both parties against a counterparty who never ships or never
//! confirms:
//!   - `purchase_escrow` buyer locks USDC; the card stays in custody (FUNDED)
//!   - `mark_shipped`    seller signals dispatch (SHIPPED) and resets the window
//!   - `confirm_receipt` buyer releases funds to seller + card to buyer (RELEASED)
//!   - `claim_timeout`   after the window, anyone releases to seller (RELEASED)
//!   - `dispute`         buyer or seller freezes auto-release (DISPUTED)
//!   - `resolve`         arbiter refunds the buyer or releases the seller
//!
//! Cards and USDC are both SAC tokens, moved through the standard token client.

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, token, Address, Env,
    Symbol, Vec,
};

/// One card unit, in stroops (classic assets use 7 decimals).
const ONE_CARD: i128 = 10_000_000;
/// Basis-points denominator for the platform fee.
const BPS_DENOM: i128 = 10_000;

/// Digital cards deliver instantly; physical cards route through escrow.
const FULFILL_DIGITAL: u32 = 0;
const FULFILL_PHYSICAL: u32 = 1;

const STATUS_OPEN: u32 = 0;
const STATUS_DONE: u32 = 1; // sold (listing) / settled (offer)
const STATUS_CANCELLED: u32 = 2; // cancelled (listing) / withdrawn (offer)

// Escrow order lifecycle. These codes are mirrored verbatim by the off-chain
// indexer, so their numeric values are part of the contract's interface.
const ORDER_FUNDED: u32 = 0; // USDC locked, awaiting shipment/confirmation
const ORDER_SHIPPED: u32 = 1; // seller marked dispatched
const ORDER_DISPUTED: u32 = 2; // frozen pending arbiter
const ORDER_RELEASED: u32 = 3; // funds -> seller, card -> buyer (terminal)
const ORDER_REFUNDED: u32 = 4; // funds -> buyer, card -> seller (terminal)

// Barter-swap lifecycle. These codes are mirrored verbatim by the off-chain
// indexer, so their numeric values are part of the contract's interface.
const SWAP_PROPOSED: u32 = 10; // proposer's give-side cards (+ any USDC) locked in custody
const SWAP_ACCEPTED: u32 = 11; // counterparty executed; all assets swapped (terminal)
const SWAP_CANCELLED: u32 = 12; // proposer cancelled; locked assets returned (terminal)
const SWAP_DECLINED: u32 = 13; // counterparty declined; locked assets returned (terminal)

// Auction lifecycle. Mirrored verbatim by the off-chain indexer, so the numeric
// values are part of the contract's interface (open=0 … no_winner=3).
const AUCTION_OPEN: u32 = 0; // accepting bids
const AUCTION_SETTLED: u32 = 1; // closed, card -> winner, funds split (terminal)
const AUCTION_CANCELLED: u32 = 2; // seller reclaimed a no-bid auction (terminal)
const AUCTION_NO_WINNER: u32 = 3; // ended with reserve unmet; card returned (terminal)

/// A bid landing within this many seconds of `ends_at` pushes `ends_at` out by
/// the same amount, so an auction can't be sniped in the final moments.
const ANTI_SNIPE_SECS: u64 = 300;
/// Upper bound on auction duration (~30 days) to keep a card from being escrowed
/// indefinitely by an absurd `duration` argument.
const MAX_AUCTION_DURATION_SECS: u64 = 2_592_000;

/// How long (seconds) a buyer has to confirm receipt before the seller may claim
/// the escrowed funds by timeout. ~14 days. `mark_shipped` restarts the clock.
const CONFIRM_WINDOW_SECS: u64 = 1_209_600;

// Persistent-entry time-to-live management. Without periodic bumps a persistent
// entry can expire and archive, which would strand escrowed funds. Testnet runs
// ~5s ledgers, so a day is ~17_280 ledgers. We bump every touched entry well
// past the longest escrow window so an in-flight order can never archive.
const LEDGERS_PER_DAY: u32 = 17_280;
const ENTRY_TTL_THRESHOLD: u32 = LEDGERS_PER_DAY * 10;
const ENTRY_TTL_EXTEND: u32 = LEDGERS_PER_DAY * 45;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum Error {
    NotInitialized = 1,
    AlreadyInitialized = 2,
    NotFound = 3,
    NotOpen = 4,
    NotSeller = 5,
    NotBuyer = 6,
    WrongListing = 7,
    BadAmount = 8,
    RoyaltyTooHigh = 9,
    Paused = 10,
    NotArbiter = 11,
    /// Action used the wrong settlement path for the listing's fulfillment mode
    /// (e.g. `buy_now` on a physical listing, or `purchase_escrow` on a digital one).
    WrongFulfillment = 12,
    /// Caller is neither the buyer nor the seller of the order.
    NotParticipant = 13,
    /// A buyer may not buy their own listing.
    SelfTrade = 14,
    /// Order is not in the DISPUTED state an arbiter resolution requires.
    NotDisputed = 15,
    /// Timeout claimed before the confirmation window elapsed.
    DeadlineNotReached = 16,
    /// Order is in a terminal state and cannot transition further.
    OrderClosed = 17,
    /// Auction is not in the open state the action requires (settled/cancelled).
    AuctionClosed = 18,
    /// Bid does not exceed the current high bid or meet the start price.
    BidTooLow = 19,
    /// Bid placed after the auction's `ends_at` has passed.
    AuctionExpired = 20,
    /// Settlement attempted before the auction's `ends_at`.
    AuctionLive = 21,
    /// Seller tried to cancel an auction that already has bids.
    AuctionHasBids = 22,
    /// Auction duration is zero or exceeds the maximum.
    BadDuration = 23,
}

#[contracttype]
#[derive(Clone)]
pub struct Listing {
    pub seller: Address,
    pub card_token: Address,
    pub price: i128,
    pub status: u32,
    /// Creator paid a royalty on resale; equals `seller` when the card has no
    /// registered royalty (then `royalty_bps` is 0 and no royalty is taken).
    pub creator: Address,
    pub royalty_bps: u32,
    /// `FULFILL_DIGITAL` (instant atomic settlement) or `FULFILL_PHYSICAL`
    /// (held escrow with delivery confirmation).
    pub fulfillment: u32,
}

/// Per-card royalty registration: who gets paid and how much, in basis points.
#[contracttype]
#[derive(Clone)]
pub struct RoyaltyConfig {
    pub creator: Address,
    pub bps: u32,
}

#[contracttype]
#[derive(Clone)]
pub struct Offer {
    pub buyer: Address,
    pub listing_id: u32,
    pub amount: i128,
    pub status: u32,
}

/// A physical-card escrow: USDC held in custody until the buyer confirms
/// receipt, the window times out, or an arbiter resolves a dispute.
#[contracttype]
#[derive(Clone)]
pub struct Order {
    pub buyer: Address,
    pub seller: Address,
    pub listing_id: u32,
    pub amount: i128,
    pub status: u32,
    /// Ledger timestamp after which `claim_timeout` may release to the seller.
    pub confirm_deadline: u64,
}

/// A timed English auction. The card is escrowed in contract custody at
/// `create_auction`; each bid escrows USDC and refunds the previous high bidder.
/// `creator`/`royalty_bps` are snapshotted from the royalty registry at creation
/// so settlement reuses the same fee/royalty split as fixed-price sales.
#[contracttype]
#[derive(Clone)]
pub struct Auction {
    pub seller: Address,
    pub card_token: Address,
    pub start_price: i128,
    pub reserve_price: i128,
    /// Ledger timestamp after which the auction can be settled. Extended by
    /// `ANTI_SNIPE_SECS` on a late bid.
    pub ends_at: u64,
    /// `None` until the first bid lands.
    pub high_bidder: Option<Address>,
    pub high_bid: i128,
    pub status: u32,
    pub creator: Address,
    pub royalty_bps: u32,
}

/// A peer-to-peer barter proposal. The proposer's give-side card tokens (and any
/// USDC sweetener) are locked into contract custody at `propose_swap`; they sit
/// there until the counterparty `execute_swap`s (all assets move in both
/// directions atomically), the proposer `cancel_swap`s, or the counterparty
/// `decline_swap`s (both return the locked assets to the proposer).
///
/// The sweetener is locked at proposal time — not pulled at execution — because
/// only the counterparty signs `execute_swap`, so the proposer's USDC must
/// already be in custody to move atomically. This mirrors how `make_offer` locks
/// the buyer's USDC up front.
#[contracttype]
#[derive(Clone)]
pub struct SwapProposal {
    pub proposer: Address,
    pub counterparty: Address,
    pub give_tokens: Vec<Address>,
    pub get_tokens: Vec<Address>,
    pub usdc_amount: i128,
    pub status: u32,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Admin,
    Platform,
    Usdc,
    FeeBps,
    MaxRoyaltyBps,
    /// Dispute arbiter; separate from `Admin` so refereeing is decoupled from
    /// contract administration. Can be re-pointed at a multisig/DAO later.
    Arbiter,
    /// Circuit breaker: when true, new trades are blocked but exit paths
    /// (cancel/withdraw/confirm/dispute/resolve/timeout) stay open.
    Paused,
    ListingCount,
    OfferCount,
    OrderCount,
    Listing(u32),
    Offer(u32),
    Order(u32),
    Royalty(Address),
    AuctionCount,
    Auction(u32),
    /// Per-bidder escrowed amount for an auction, kept so `claim_refund` can
    /// recover funds if an auto-refund on outbid ever fails.
    Bid(u32, Address),
    SwapCount,
    SwapProposal(u32),
}

#[contract]
pub struct Marketplace;

#[contractimpl]
impl Marketplace {
    // --- init ---

    /// One-time setup: platform fee collector, dispute arbiter, USDC token, fee
    /// and the royalty ceiling, both in basis points. `fee_bps + max_royalty_bps`
    /// must stay below 100% so every settlement leaves the seller a non-negative
    /// share.
    pub fn init(
        env: Env,
        admin: Address,
        platform: Address,
        arbiter: Address,
        usdc_token: Address,
        fee_bps: u32,
        max_royalty_bps: u32,
    ) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic_with(&env, Error::AlreadyInitialized);
        }
        admin.require_auth();
        if (fee_bps as i128) + (max_royalty_bps as i128) >= BPS_DENOM {
            panic_with(&env, Error::BadAmount);
        }
        let s = env.storage().instance();
        s.set(&DataKey::Admin, &admin);
        s.set(&DataKey::Platform, &platform);
        s.set(&DataKey::Arbiter, &arbiter);
        s.set(&DataKey::Paused, &false);
        s.set(&DataKey::Usdc, &usdc_token);
        s.set(&DataKey::FeeBps, &fee_bps);
        s.set(&DataKey::MaxRoyaltyBps, &max_royalty_bps);
        s.set(&DataKey::ListingCount, &0u32);
        s.set(&DataKey::OfferCount, &0u32);
        s.set(&DataKey::OrderCount, &0u32);
    }

    // --- admin: arbiter / pause ---

    /// Admin re-points the dispute arbiter (e.g. to a multisig).
    pub fn set_arbiter(env: Env, arbiter: Address) {
        require_init(&env);
        admin(&env).require_auth();
        env.storage().instance().set(&DataKey::Arbiter, &arbiter);
        env.events()
            .publish((Symbol::new(&env, "arbiter"),), arbiter);
    }

    /// Admin toggles the circuit breaker. While paused, new trades are blocked
    /// but every exit path stays open so funds can never be trapped.
    pub fn set_paused(env: Env, paused: bool) {
        require_init(&env);
        admin(&env).require_auth();
        env.storage().instance().set(&DataKey::Paused, &paused);
        env.events().publish((Symbol::new(&env, "paused"),), paused);
    }

    // --- royalty registry ---

    /// Admin registers (or updates) the creator royalty for a card. Rejected if
    /// `royalty_bps` exceeds the ceiling fixed at `init`. Open listings keep the
    /// royalty they snapshotted at `list` time, so this only affects future ones.
    pub fn set_royalty(env: Env, card_token: Address, creator: Address, royalty_bps: u32) {
        require_init(&env);
        admin(&env).require_auth();
        let max: u32 = env
            .storage()
            .instance()
            .get(&DataKey::MaxRoyaltyBps)
            .unwrap_or(0);
        if royalty_bps > max {
            panic_with(&env, Error::RoyaltyTooHigh);
        }
        let cfg = RoyaltyConfig {
            creator: creator.clone(),
            bps: royalty_bps,
        };
        env.storage()
            .persistent()
            .set(&DataKey::Royalty(card_token.clone()), &cfg);
        env.events().publish(
            (Symbol::new(&env, "royalty"), card_token),
            (creator, royalty_bps),
        );
    }

    // --- list / cancel_listing ---

    /// Seller locks one card into escrow at `price` (USDC stroops) under the
    /// given `fulfillment` mode (0 = digital, 1 = physical). Returns the listing id.
    pub fn list(env: Env, seller: Address, card_token: Address, price: i128, fulfillment: u32) -> u32 {
        require_init(&env);
        require_not_paused(&env);
        seller.require_auth();
        if price <= 0 {
            panic_with(&env, Error::BadAmount);
        }
        if fulfillment != FULFILL_DIGITAL && fulfillment != FULFILL_PHYSICAL {
            panic_with(&env, Error::BadAmount);
        }
        // Pull the card into contract custody.
        token::TokenClient::new(&env, &card_token).transfer(
            &seller,
            &env.current_contract_address(),
            &ONE_CARD,
        );

        // Snapshot the card's registered royalty onto the listing so later
        // registry changes can't alter an already-open listing's economics. A
        // card with no registration defaults to no royalty (creator = seller).
        let (creator, royalty_bps) = match env
            .storage()
            .persistent()
            .get::<_, RoyaltyConfig>(&DataKey::Royalty(card_token.clone()))
        {
            Some(cfg) => (cfg.creator, cfg.bps),
            None => (seller.clone(), 0u32),
        };

        let id = next_id(&env, &DataKey::ListingCount);
        let listing = Listing {
            seller: seller.clone(),
            card_token,
            price,
            status: STATUS_OPEN,
            creator,
            royalty_bps,
            fulfillment,
        };
        put_listing(&env, id, &listing);

        env.events()
            .publish((Symbol::new(&env, "list"), id), (seller, price, fulfillment));
        id
    }

    /// Seller reclaims an unsold listing's card.
    pub fn cancel_listing(env: Env, seller: Address, listing_id: u32) {
        require_init(&env);
        seller.require_auth();
        let mut listing = get_listing(&env, listing_id);
        if listing.status != STATUS_OPEN {
            panic_with(&env, Error::NotOpen);
        }
        if listing.seller != seller {
            panic_with(&env, Error::NotSeller);
        }
        token::TokenClient::new(&env, &listing.card_token).transfer(
            &env.current_contract_address(),
            &seller,
            &ONE_CARD,
        );
        listing.status = STATUS_CANCELLED;
        put_listing(&env, listing_id, &listing);
        env.events()
            .publish((Symbol::new(&env, "cancel"), listing_id), seller);
    }

    // --- make_offer / withdraw_offer ---

    /// Buyer locks USDC into escrow against a listing. Returns the offer id.
    pub fn make_offer(env: Env, buyer: Address, listing_id: u32, amount: i128) -> u32 {
        require_init(&env);
        require_not_paused(&env);
        buyer.require_auth();
        if amount <= 0 {
            panic_with(&env, Error::BadAmount);
        }
        let listing = get_listing(&env, listing_id);
        if listing.status != STATUS_OPEN {
            panic_with(&env, Error::NotOpen);
        }
        if listing.seller == buyer {
            panic_with(&env, Error::SelfTrade);
        }
        usdc(&env).transfer(&buyer, &env.current_contract_address(), &amount);

        let id = next_id(&env, &DataKey::OfferCount);
        let offer = Offer {
            buyer: buyer.clone(),
            listing_id,
            amount,
            status: STATUS_OPEN,
        };
        put_offer(&env, id, &offer);

        env.events().publish(
            (Symbol::new(&env, "offer"), id),
            (buyer, listing_id, amount),
        );
        id
    }

    /// Buyer reclaims an un-accepted offer's USDC.
    pub fn withdraw_offer(env: Env, buyer: Address, offer_id: u32) {
        require_init(&env);
        buyer.require_auth();
        let mut offer = get_offer(&env, offer_id);
        if offer.status != STATUS_OPEN {
            panic_with(&env, Error::NotOpen);
        }
        if offer.buyer != buyer {
            panic_with(&env, Error::NotBuyer);
        }
        usdc(&env).transfer(&env.current_contract_address(), &buyer, &offer.amount);
        offer.status = STATUS_CANCELLED;
        put_offer(&env, offer_id, &offer);
        env.events()
            .publish((Symbol::new(&env, "withdraw"), offer_id), buyer);
    }

    // --- accept_offer (atomic settlement, digital) ---

    /// Seller accepts an offer; settles atomically (card -> buyer, USDC-fee -> seller, fee -> platform).
    /// Digital listings only — physical listings settle through the escrow order flow.
    pub fn accept_offer(env: Env, seller: Address, offer_id: u32) {
        require_init(&env);
        seller.require_auth();
        let mut offer = get_offer(&env, offer_id);
        if offer.status != STATUS_OPEN {
            panic_with(&env, Error::NotOpen);
        }
        let mut listing = get_listing(&env, offer.listing_id);
        if listing.status != STATUS_OPEN {
            panic_with(&env, Error::NotOpen);
        }
        if listing.seller != seller {
            panic_with(&env, Error::NotSeller);
        }
        if listing.fulfillment != FULFILL_DIGITAL {
            panic_with(&env, Error::WrongFulfillment);
        }

        // Funds are already escrowed in the contract; distribute from custody.
        let (fee, royalty) = release_from_custody(&env, &listing, &offer.buyer, offer.amount);

        listing.status = STATUS_DONE;
        offer.status = STATUS_DONE;
        put_listing(&env, offer.listing_id, &listing);
        put_offer(&env, offer_id, &offer);

        env.events().publish(
            (Symbol::new(&env, "settle"), offer.listing_id),
            (
                offer.buyer,
                listing.seller,
                offer.amount,
                fee,
                royalty,
                listing.creator,
            ),
        );
    }

    // --- buy_now (settlement at asking price, digital) ---

    /// Buyer purchases at the listing's asking price; settles atomically.
    /// Digital listings only — physical listings use `purchase_escrow`.
    pub fn buy_now(env: Env, buyer: Address, listing_id: u32) {
        require_init(&env);
        require_not_paused(&env);
        buyer.require_auth();
        let mut listing = get_listing(&env, listing_id);
        if listing.status != STATUS_OPEN {
            panic_with(&env, Error::NotOpen);
        }
        if listing.fulfillment != FULFILL_DIGITAL {
            panic_with(&env, Error::WrongFulfillment);
        }
        if listing.seller == buyer {
            panic_with(&env, Error::SelfTrade);
        }

        let fee = split_fee(&env, listing.price);
        let royalty = royalty_for(&env, &listing, listing.price);
        let seller_amount = listing.price - fee - royalty;
        let u = usdc(&env);
        // Buyer pays directly; the trade is atomic so no intermediate escrow is needed.
        u.transfer(&buyer, &listing.seller, &seller_amount);
        if fee > 0 {
            u.transfer(&buyer, &platform(&env), &fee);
        }
        if royalty > 0 {
            u.transfer(&buyer, &listing.creator, &royalty);
        }
        token::TokenClient::new(&env, &listing.card_token).transfer(
            &env.current_contract_address(),
            &buyer,
            &ONE_CARD,
        );

        listing.status = STATUS_DONE;
        put_listing(&env, listing_id, &listing);
        env.events().publish(
            (Symbol::new(&env, "settle"), listing_id),
            (
                buyer,
                listing.seller.clone(),
                listing.price,
                fee,
                royalty,
                listing.creator,
            ),
        );
    }

    // --- physical escrow: purchase / ship / confirm / timeout / dispute / resolve ---

    /// Buyer locks the asking price in USDC against a physical listing. The card
    /// stays in contract custody; funds release only when the buyer confirms
    /// receipt (or the window times out / an arbiter resolves). Returns the order id.
    pub fn purchase_escrow(env: Env, buyer: Address, listing_id: u32) -> u32 {
        require_init(&env);
        require_not_paused(&env);
        buyer.require_auth();
        let mut listing = get_listing(&env, listing_id);
        if listing.status != STATUS_OPEN {
            panic_with(&env, Error::NotOpen);
        }
        if listing.fulfillment != FULFILL_PHYSICAL {
            panic_with(&env, Error::WrongFulfillment);
        }
        if listing.seller == buyer {
            panic_with(&env, Error::SelfTrade);
        }

        // Lock the buyer's funds into custody alongside the already-escrowed card.
        usdc(&env).transfer(&buyer, &env.current_contract_address(), &listing.price);

        // Reserve the listing so it can't be sold twice while in escrow.
        listing.status = STATUS_DONE;
        put_listing(&env, listing_id, &listing);

        let deadline = env.ledger().timestamp() + CONFIRM_WINDOW_SECS;
        let id = next_id(&env, &DataKey::OrderCount);
        let order = Order {
            buyer: buyer.clone(),
            seller: listing.seller.clone(),
            listing_id,
            amount: listing.price,
            status: ORDER_FUNDED,
            confirm_deadline: deadline,
        };
        put_order(&env, id, &order);

        env.events().publish(
            (Symbol::new(&env, "escrow"), id),
            (buyer, listing_id, listing.price, deadline),
        );
        id
    }

    /// Seller marks the order shipped and restarts the confirmation window so the
    /// buyer gets the full window measured from dispatch.
    pub fn mark_shipped(env: Env, seller: Address, order_id: u32) {
        require_init(&env);
        seller.require_auth();
        let mut order = get_order(&env, order_id);
        if order.seller != seller {
            panic_with(&env, Error::NotSeller);
        }
        if order.status != ORDER_FUNDED {
            panic_with(&env, Error::OrderClosed);
        }
        order.status = ORDER_SHIPPED;
        order.confirm_deadline = env.ledger().timestamp() + CONFIRM_WINDOW_SECS;
        put_order(&env, order_id, &order);
        env.events().publish(
            (Symbol::new(&env, "shipped"), order_id),
            (seller, order.confirm_deadline),
        );
    }

    /// Buyer confirms receipt: releases escrowed funds to the seller (less
    /// fee/royalty) and the card to the buyer.
    pub fn confirm_receipt(env: Env, buyer: Address, order_id: u32) {
        require_init(&env);
        buyer.require_auth();
        let mut order = get_order(&env, order_id);
        if order.buyer != buyer {
            panic_with(&env, Error::NotBuyer);
        }
        require_active(&env, &order);
        release_order(&env, order_id, &mut order);
    }

    /// After the confirmation window elapses on an undisputed order, release the
    /// funds to the seller. Permissionless so a relayer can settle it gaslessly;
    /// protects the seller from a buyer who never confirms.
    pub fn claim_timeout(env: Env, order_id: u32) {
        require_init(&env);
        let mut order = get_order(&env, order_id);
        require_active(&env, &order);
        if env.ledger().timestamp() < order.confirm_deadline {
            panic_with(&env, Error::DeadlineNotReached);
        }
        release_order(&env, order_id, &mut order);
    }

    /// Either participant freezes the order pending arbiter resolution.
    pub fn dispute(env: Env, caller: Address, order_id: u32) {
        require_init(&env);
        caller.require_auth();
        let mut order = get_order(&env, order_id);
        if caller != order.buyer && caller != order.seller {
            panic_with(&env, Error::NotParticipant);
        }
        require_active(&env, &order);
        order.status = ORDER_DISPUTED;
        put_order(&env, order_id, &order);
        env.events()
            .publish((Symbol::new(&env, "dispute"), order_id), caller);
    }

    /// Arbiter resolves a disputed order: `refund = true` returns funds to the
    /// buyer and the card to the seller; `refund = false` releases to the seller.
    pub fn resolve(env: Env, order_id: u32, refund: bool) {
        require_init(&env);
        arbiter(&env).require_auth();
        let mut order = get_order(&env, order_id);
        if order.status != ORDER_DISPUTED {
            panic_with(&env, Error::NotDisputed);
        }
        if refund {
            let listing = get_listing(&env, order.listing_id);
            refund_to_buyer(&env, &listing, &order.buyer, order.amount);
            order.status = ORDER_REFUNDED;
            put_order(&env, order_id, &order);
            env.events().publish(
                (Symbol::new(&env, "resolve"), order_id),
                (order.buyer, order.amount, true),
            );
        } else {
            release_order(&env, order_id, &mut order);
            env.events().publish(
                (Symbol::new(&env, "resolve"), order_id),
                (order.seller, order.amount, false),
            );
        }
    }

    // --- auctions: create / bid / settle / cancel / claim_refund ---

    /// Seller escrows a card into a timed English auction. `duration` is in
    /// seconds; `ends_at` is computed as `now + duration`. A zero or absurdly
    /// long duration is rejected. Returns the auction id.
    pub fn create_auction(
        env: Env,
        seller: Address,
        card_token: Address,
        start_price: i128,
        reserve_price: i128,
        duration: u64,
    ) -> u32 {
        require_init(&env);
        require_not_paused(&env);
        seller.require_auth();
        if start_price <= 0 || reserve_price < 0 {
            panic_with(&env, Error::BadAmount);
        }
        if duration == 0 || duration > MAX_AUCTION_DURATION_SECS {
            panic_with(&env, Error::BadDuration);
        }
        // Pull the card into contract custody (the card can only be escrowed once,
        // which blocks a duplicate auction/listing on the same copy).
        token::TokenClient::new(&env, &card_token).transfer(
            &seller,
            &env.current_contract_address(),
            &ONE_CARD,
        );

        // Snapshot the card's registered royalty, exactly as `list` does.
        let (creator, royalty_bps) = match env
            .storage()
            .persistent()
            .get::<_, RoyaltyConfig>(&DataKey::Royalty(card_token.clone()))
        {
            Some(cfg) => (cfg.creator, cfg.bps),
            None => (seller.clone(), 0u32),
        };

        let ends_at = env.ledger().timestamp() + duration;
        let id = next_id(&env, &DataKey::AuctionCount);
        let auction = Auction {
            seller: seller.clone(),
            card_token: card_token.clone(),
            start_price,
            reserve_price,
            ends_at,
            high_bidder: None,
            high_bid: 0,
            status: AUCTION_OPEN,
            creator,
            royalty_bps,
        };
        put_auction(&env, id, &auction);

        env.events().publish(
            (Symbol::new(&env, "auction_created"), id),
            (seller, card_token, start_price, reserve_price, ends_at),
        );
        id
    }

    /// Bidder escrows `amount` in USDC. The bid must exceed the current high bid
    /// and meet the start price; the previous high bidder is refunded atomically.
    /// A bid inside the final `ANTI_SNIPE_SECS` extends `ends_at`.
    pub fn place_bid(env: Env, bidder: Address, auction_id: u32, amount: i128) {
        require_init(&env);
        require_not_paused(&env);
        bidder.require_auth();
        let mut auction = get_auction(&env, auction_id);
        if auction.status != AUCTION_OPEN {
            panic_with(&env, Error::AuctionClosed);
        }
        if env.ledger().timestamp() >= auction.ends_at {
            panic_with(&env, Error::AuctionExpired);
        }
        if auction.seller == bidder {
            panic_with(&env, Error::SelfTrade);
        }
        if amount <= auction.high_bid || amount < auction.start_price {
            panic_with(&env, Error::BidTooLow);
        }

        // Escrow the new bid, then refund the previous high bidder from custody.
        let contract = env.current_contract_address();
        let u = usdc(&env);
        u.transfer(&bidder, &contract, &amount);
        set_bid(&env, auction_id, &bidder, amount);

        if let Some(prev) = auction.high_bidder.clone() {
            let prev_amount = auction.high_bid;
            u.transfer(&contract, &prev, &prev_amount);
            set_bid(&env, auction_id, &prev, 0);
            env.events().publish(
                (Symbol::new(&env, "outbid"), auction_id),
                (prev, prev_amount),
            );
        }

        // Anti-snipe: a late bid pushes the deadline out so it can't be sniped.
        if env.ledger().timestamp() > auction.ends_at - ANTI_SNIPE_SECS {
            auction.ends_at += ANTI_SNIPE_SECS;
        }
        auction.high_bidder = Some(bidder.clone());
        auction.high_bid = amount;
        put_auction(&env, auction_id, &auction);

        env.events().publish(
            (Symbol::new(&env, "bid_placed"), auction_id),
            (bidder, amount, auction.ends_at),
        );
    }

    /// Settle an expired auction. Callable by anyone once `ends_at` has passed.
    /// If the high bid meets the reserve, the card goes to the winner and funds
    /// split fee/royalty/seller-net; otherwise the card returns to the seller and
    /// the high bidder (if any) is refunded.
    pub fn settle_auction(env: Env, auction_id: u32) {
        require_init(&env);
        let mut auction = get_auction(&env, auction_id);
        if auction.status != AUCTION_OPEN {
            panic_with(&env, Error::AuctionClosed);
        }
        if env.ledger().timestamp() < auction.ends_at {
            panic_with(&env, Error::AuctionLive);
        }

        let reserve_met = auction.high_bid >= auction.reserve_price;
        match (auction.high_bidder.clone(), reserve_met) {
            (Some(winner), true) => {
                let (fee, royalty) = settle_funds(
                    &env,
                    &auction.seller,
                    &auction.creator,
                    auction.royalty_bps,
                    &auction.card_token,
                    &winner,
                    auction.high_bid,
                );
                set_bid(&env, auction_id, &winner, 0);
                auction.status = AUCTION_SETTLED;
                put_auction(&env, auction_id, &auction);
                env.events().publish(
                    (Symbol::new(&env, "auction_settled"), auction_id),
                    (
                        winner,
                        auction.seller.clone(),
                        auction.high_bid,
                        fee,
                        royalty,
                        auction.creator.clone(),
                    ),
                );
            }
            (high_bidder, _) => {
                // No bids, or reserve not met: return the card, refund any bidder.
                let contract = env.current_contract_address();
                if let Some(bidder) = high_bidder {
                    usdc(&env).transfer(&contract, &bidder, &auction.high_bid);
                    set_bid(&env, auction_id, &bidder, 0);
                }
                token::TokenClient::new(&env, &auction.card_token).transfer(
                    &contract,
                    &auction.seller,
                    &ONE_CARD,
                );
                auction.status = AUCTION_NO_WINNER;
                put_auction(&env, auction_id, &auction);
                env.events().publish(
                    (Symbol::new(&env, "auction_cancelled"), auction_id),
                    auction.seller.clone(),
                );
            }
        }
    }

    /// Seller cancels an open auction that has received no bids and reclaims the
    /// card. Cancellation is blocked once any bid exists.
    pub fn cancel_auction(env: Env, seller: Address, auction_id: u32) {
        require_init(&env);
        seller.require_auth();
        let mut auction = get_auction(&env, auction_id);
        if auction.status != AUCTION_OPEN {
            panic_with(&env, Error::AuctionClosed);
        }
        if auction.seller != seller {
            panic_with(&env, Error::NotSeller);
        }
        if auction.high_bid != 0 {
            panic_with(&env, Error::AuctionHasBids);
        }
        token::TokenClient::new(&env, &auction.card_token).transfer(
            &env.current_contract_address(),
            &seller,
            &ONE_CARD,
        );
        auction.status = AUCTION_CANCELLED;
        put_auction(&env, auction_id, &auction);
        env.events()
            .publish((Symbol::new(&env, "auction_cancelled"), auction_id), seller);
    }

    /// Safety valve: a bidder withdraws any escrowed amount still recorded against
    /// them (e.g. an auto-refund on outbid failed). The current high bidder of an
    /// open auction cannot claim — their funds are committed to winning.
    pub fn claim_refund(env: Env, bidder: Address, auction_id: u32) {
        require_init(&env);
        bidder.require_auth();
        let auction = get_auction(&env, auction_id);
        if auction.status == AUCTION_OPEN && auction.high_bidder == Some(bidder.clone()) {
            panic_with(&env, Error::BidTooLow);
        }
        let amount = get_bid(&env, auction_id, &bidder);
        if amount <= 0 {
            return; // nothing owed — no-op
        }
        usdc(&env).transfer(&env.current_contract_address(), &bidder, &amount);
        set_bid(&env, auction_id, &bidder, 0);
        env.events().publish(
            (Symbol::new(&env, "refund"), auction_id),
            (bidder, amount),
        );
    }

    // --- barter swap: propose / execute / cancel / decline ---

    /// Proposer locks their give-side card tokens (and any USDC sweetener) into
    /// contract custody and records a pending swap targeted at `counterparty`.
    /// Returns the proposal id. Only the proposer signs this tx.
    pub fn propose_swap(
        env: Env,
        proposer: Address,
        counterparty: Address,
        give_tokens: Vec<Address>,
        get_tokens: Vec<Address>,
        usdc_amount: i128,
    ) -> u32 {
        require_init(&env);
        require_not_paused(&env);
        proposer.require_auth();
        if proposer == counterparty {
            panic_with(&env, Error::SelfTrade);
        }
        if give_tokens.is_empty() {
            panic_with(&env, Error::BadAmount);
        }
        if usdc_amount < 0 {
            panic_with(&env, Error::BadAmount);
        }

        let contract = env.current_contract_address();
        // Pull each give-side card into custody.
        for token_addr in give_tokens.iter() {
            token::TokenClient::new(&env, &token_addr).transfer(&proposer, &contract, &ONE_CARD);
        }
        // Lock the USDC sweetener up front so it can move atomically when only the
        // counterparty signs `execute_swap`.
        if usdc_amount > 0 {
            usdc(&env).transfer(&proposer, &contract, &usdc_amount);
        }

        let id = next_id(&env, &DataKey::SwapCount);
        let proposal = SwapProposal {
            proposer: proposer.clone(),
            counterparty: counterparty.clone(),
            give_tokens,
            get_tokens,
            usdc_amount,
            status: SWAP_PROPOSED,
        };
        put_swap(&env, id, &proposal);

        env.events().publish(
            (Symbol::new(&env, "swap_proposed"), id),
            (proposer, counterparty, usdc_amount),
        );
        id
    }

    /// Counterparty accepts: pulls their get-side cards to the proposer, releases
    /// the proposer's escrowed give-side cards to the counterparty, and (for a
    /// USDC sweetener) pays the platform fee and the remainder to the
    /// counterparty — all atomically. Only the counterparty signs this tx.
    pub fn execute_swap(env: Env, counterparty: Address, proposal_id: u32) {
        require_init(&env);
        require_not_paused(&env);
        counterparty.require_auth();
        let mut proposal = get_swap(&env, proposal_id);
        if proposal.status != SWAP_PROPOSED {
            panic_with(&env, Error::NotOpen);
        }
        if proposal.counterparty != counterparty {
            panic_with(&env, Error::NotParticipant);
        }

        let contract = env.current_contract_address();
        // Counterparty's get-side cards go straight to the proposer.
        for token_addr in proposal.get_tokens.iter() {
            token::TokenClient::new(&env, &token_addr).transfer(
                &counterparty,
                &proposal.proposer,
                &ONE_CARD,
            );
        }
        // Proposer's escrowed give-side cards are released to the counterparty.
        for token_addr in proposal.give_tokens.iter() {
            token::TokenClient::new(&env, &token_addr).transfer(&contract, &counterparty, &ONE_CARD);
        }
        // USDC sweetener (if any): fee to platform, remainder to the counterparty.
        // Pure card-for-card swaps move no USDC and carry no fee.
        let mut fee = 0i128;
        if proposal.usdc_amount > 0 {
            fee = split_fee(&env, proposal.usdc_amount);
            let u = usdc(&env);
            if fee > 0 {
                u.transfer(&contract, &platform(&env), &fee);
            }
            u.transfer(&contract, &counterparty, &(proposal.usdc_amount - fee));
        }

        proposal.status = SWAP_ACCEPTED;
        put_swap(&env, proposal_id, &proposal);

        env.events().publish(
            (Symbol::new(&env, "swap"), proposal_id),
            (
                proposal.proposer.clone(),
                proposal.counterparty.clone(),
                proposal.give_tokens.clone(),
                proposal.get_tokens.clone(),
                proposal.usdc_amount,
                fee,
            ),
        );
    }

    /// Proposer cancels a still-pending proposal; all locked give-side cards and
    /// the USDC sweetener are returned to the proposer.
    pub fn cancel_swap(env: Env, proposer: Address, proposal_id: u32) {
        require_init(&env);
        proposer.require_auth();
        let mut proposal = get_swap(&env, proposal_id);
        if proposal.status != SWAP_PROPOSED {
            panic_with(&env, Error::NotOpen);
        }
        if proposal.proposer != proposer {
            panic_with(&env, Error::NotParticipant);
        }
        return_swap_assets(&env, &proposal);
        proposal.status = SWAP_CANCELLED;
        put_swap(&env, proposal_id, &proposal);
        env.events()
            .publish((Symbol::new(&env, "swap_cancel"), proposal_id), proposer);
    }

    /// Counterparty declines a pending proposal; all locked give-side cards and
    /// the USDC sweetener are returned to the proposer.
    pub fn decline_swap(env: Env, counterparty: Address, proposal_id: u32) {
        require_init(&env);
        counterparty.require_auth();
        let mut proposal = get_swap(&env, proposal_id);
        if proposal.status != SWAP_PROPOSED {
            panic_with(&env, Error::NotOpen);
        }
        if proposal.counterparty != counterparty {
            panic_with(&env, Error::NotParticipant);
        }
        return_swap_assets(&env, &proposal);
        proposal.status = SWAP_DECLINED;
        put_swap(&env, proposal_id, &proposal);
        env.events().publish(
            (Symbol::new(&env, "swap_decline"), proposal_id),
            counterparty,
        );
    }

    // --- views ---

    pub fn get_swap_view(env: Env, proposal_id: u32) -> SwapProposal {
        get_swap(&env, proposal_id)
    }

    pub fn get_auction_view(env: Env, auction_id: u32) -> Auction {
        get_auction(&env, auction_id)
    }

    pub fn get_listing_view(env: Env, listing_id: u32) -> Listing {
        get_listing(&env, listing_id)
    }

    pub fn get_offer_view(env: Env, offer_id: u32) -> Offer {
        get_offer(&env, offer_id)
    }

    pub fn get_order_view(env: Env, order_id: u32) -> Order {
        get_order(&env, order_id)
    }

    pub fn fee_bps(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::FeeBps).unwrap_or(0)
    }

    pub fn max_royalty_bps(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::MaxRoyaltyBps)
            .unwrap_or(0)
    }

    pub fn arbiter_view(env: Env) -> Address {
        arbiter(&env)
    }

    pub fn is_paused(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false)
    }

    /// The registered royalty for a card. An unregistered card reports `bps = 0`
    /// with `card_token` itself as a placeholder creator (no royalty is taken).
    pub fn get_royalty_view(env: Env, card_token: Address) -> RoyaltyConfig {
        env.storage()
            .persistent()
            .get(&DataKey::Royalty(card_token.clone()))
            .unwrap_or(RoyaltyConfig {
                creator: card_token,
                bps: 0,
            })
    }
}

// --- helpers ---

fn require_init(env: &Env) {
    if !env.storage().instance().has(&DataKey::Admin) {
        panic_with(env, Error::NotInitialized);
    }
}

fn require_not_paused(env: &Env) {
    let paused: bool = env
        .storage()
        .instance()
        .get(&DataKey::Paused)
        .unwrap_or(false);
    if paused {
        panic_with(env, Error::Paused);
    }
}

/// An order is "active" (transitionable by the participant flow) while funded or
/// shipped; disputed and terminal states reject those transitions.
fn require_active(env: &Env, order: &Order) {
    if order.status == ORDER_DISPUTED {
        panic_with(env, Error::NotOpen);
    }
    if order.status != ORDER_FUNDED && order.status != ORDER_SHIPPED {
        panic_with(env, Error::OrderClosed);
    }
}

/// Settle an escrow order in the seller's favour: funds from custody (less
/// fee/royalty) to the seller, the card to the buyer. Marks the order RELEASED.
fn release_order(env: &Env, order_id: u32, order: &mut Order) {
    let listing = get_listing(env, order.listing_id);
    let (fee, royalty) = release_from_custody(env, &listing, &order.buyer, order.amount);
    order.status = ORDER_RELEASED;
    put_order(env, order_id, order);
    env.events().publish(
        (Symbol::new(env, "release"), order_id),
        (order.buyer.clone(), order.seller.clone(), order.amount, fee, royalty),
    );
}

/// Pay out an escrowed `amount` held in contract custody: seller gets the
/// remainder after the platform fee and any creator royalty, and the buyer gets
/// the card. Returns `(fee, royalty)` for event reporting. Shared by
/// `accept_offer` and the physical-escrow release paths.
fn release_from_custody(
    env: &Env,
    listing: &Listing,
    buyer: &Address,
    amount: i128,
) -> (i128, i128) {
    settle_funds(
        env,
        &listing.seller,
        &listing.creator,
        listing.royalty_bps,
        &listing.card_token,
        buyer,
        amount,
    )
}

/// The fee/royalty/seller-net split shared by fixed-price (`accept_offer`,
/// physical release) and auction (`settle_auction`) settlement. Pays out an
/// `amount` escrowed in custody: seller gets the remainder after the platform
/// fee and any creator royalty, and `buyer` gets the card. Returns `(fee,
/// royalty)` for event reporting.
fn settle_funds(
    env: &Env,
    seller: &Address,
    creator: &Address,
    royalty_bps: u32,
    card_token: &Address,
    buyer: &Address,
    amount: i128,
) -> (i128, i128) {
    let contract = env.current_contract_address();
    let fee = split_fee(env, amount);
    let royalty = if royalty_bps == 0 || seller == creator {
        0
    } else {
        split_royalty(amount, royalty_bps)
    };
    let seller_amount = amount - fee - royalty;
    let u = usdc(env);
    u.transfer(&contract, seller, &seller_amount);
    if fee > 0 {
        u.transfer(&contract, &platform(env), &fee);
    }
    if royalty > 0 {
        u.transfer(&contract, creator, &royalty);
    }
    token::TokenClient::new(env, card_token).transfer(&contract, buyer, &ONE_CARD);
    (fee, royalty)
}

/// Reverse an escrow: return the full USDC to the buyer and the card to the
/// seller. No fee is taken on a refund.
fn refund_to_buyer(env: &Env, listing: &Listing, buyer: &Address, amount: i128) {
    let contract = env.current_contract_address();
    usdc(env).transfer(&contract, buyer, &amount);
    token::TokenClient::new(env, &listing.card_token).transfer(&contract, &listing.seller, &ONE_CARD);
}

fn usdc(env: &Env) -> token::TokenClient<'_> {
    let addr: Address = env.storage().instance().get(&DataKey::Usdc).unwrap();
    token::TokenClient::new(env, &addr)
}

fn platform(env: &Env) -> Address {
    env.storage().instance().get(&DataKey::Platform).unwrap()
}

fn admin(env: &Env) -> Address {
    env.storage().instance().get(&DataKey::Admin).unwrap()
}

fn arbiter(env: &Env) -> Address {
    env.storage().instance().get(&DataKey::Arbiter).unwrap()
}

fn split_fee(env: &Env, amount: i128) -> i128 {
    let bps: u32 = env.storage().instance().get(&DataKey::FeeBps).unwrap_or(0);
    amount * (bps as i128) / BPS_DENOM
}

fn split_royalty(amount: i128, bps: u32) -> i128 {
    amount * (bps as i128) / BPS_DENOM
}

/// Royalty owed on a settlement: nothing on a primary sale (seller is the
/// creator), otherwise the listing's snapshotted rate applied to `amount`.
fn royalty_for(_env: &Env, listing: &Listing, amount: i128) -> i128 {
    if listing.royalty_bps == 0 || listing.seller == listing.creator {
        0
    } else {
        split_royalty(amount, listing.royalty_bps)
    }
}

fn next_id(env: &Env, key: &DataKey) -> u32 {
    let current: u32 = env.storage().instance().get(key).unwrap_or(0);
    let id = current + 1;
    env.storage().instance().set(key, &id);
    id
}

// Persistent reads/writes go through these helpers so every touch bumps the
// entry's TTL — an in-flight listing/offer/order can never archive and strand
// the value it escrows.

fn put_listing(env: &Env, id: u32, listing: &Listing) {
    let key = DataKey::Listing(id);
    env.storage().persistent().set(&key, listing);
    env.storage()
        .persistent()
        .extend_ttl(&key, ENTRY_TTL_THRESHOLD, ENTRY_TTL_EXTEND);
}

fn put_offer(env: &Env, id: u32, offer: &Offer) {
    let key = DataKey::Offer(id);
    env.storage().persistent().set(&key, offer);
    env.storage()
        .persistent()
        .extend_ttl(&key, ENTRY_TTL_THRESHOLD, ENTRY_TTL_EXTEND);
}

fn put_swap(env: &Env, id: u32, proposal: &SwapProposal) {
    let key = DataKey::SwapProposal(id);
    env.storage().persistent().set(&key, proposal);
    env.storage()
        .persistent()
        .extend_ttl(&key, ENTRY_TTL_THRESHOLD, ENTRY_TTL_EXTEND);
}

fn get_swap(env: &Env, id: u32) -> SwapProposal {
    let key = DataKey::SwapProposal(id);
    let proposal = env
        .storage()
        .persistent()
        .get(&key)
        .unwrap_or_else(|| panic_with(env, Error::NotFound));
    env.storage()
        .persistent()
        .extend_ttl(&key, ENTRY_TTL_THRESHOLD, ENTRY_TTL_EXTEND);
    proposal
}

/// Return a pending proposal's escrowed assets to the proposer: every give-side
/// card and the USDC sweetener. Shared by `cancel_swap` and `decline_swap`.
fn return_swap_assets(env: &Env, proposal: &SwapProposal) {
    let contract = env.current_contract_address();
    for token_addr in proposal.give_tokens.iter() {
        token::TokenClient::new(env, &token_addr).transfer(
            &contract,
            &proposal.proposer,
            &ONE_CARD,
        );
    }
    if proposal.usdc_amount > 0 {
        usdc(env).transfer(&contract, &proposal.proposer, &proposal.usdc_amount);
    }
}

fn put_order(env: &Env, id: u32, order: &Order) {
    let key = DataKey::Order(id);
    env.storage().persistent().set(&key, order);
    env.storage()
        .persistent()
        .extend_ttl(&key, ENTRY_TTL_THRESHOLD, ENTRY_TTL_EXTEND);
}

fn put_auction(env: &Env, id: u32, auction: &Auction) {
    let key = DataKey::Auction(id);
    env.storage().persistent().set(&key, auction);
    env.storage()
        .persistent()
        .extend_ttl(&key, ENTRY_TTL_THRESHOLD, ENTRY_TTL_EXTEND);
}

fn get_auction(env: &Env, id: u32) -> Auction {
    let key = DataKey::Auction(id);
    let auction = env
        .storage()
        .persistent()
        .get(&key)
        .unwrap_or_else(|| panic_with(env, Error::NotFound));
    env.storage()
        .persistent()
        .extend_ttl(&key, ENTRY_TTL_THRESHOLD, ENTRY_TTL_EXTEND);
    auction
}

/// Per-bidder escrow balance for an auction. Absent key reads as zero.
fn get_bid(env: &Env, auction_id: u32, bidder: &Address) -> i128 {
    env.storage()
        .persistent()
        .get(&DataKey::Bid(auction_id, bidder.clone()))
        .unwrap_or(0)
}

fn set_bid(env: &Env, auction_id: u32, bidder: &Address, amount: i128) {
    let key = DataKey::Bid(auction_id, bidder.clone());
    env.storage().persistent().set(&key, &amount);
    env.storage()
        .persistent()
        .extend_ttl(&key, ENTRY_TTL_THRESHOLD, ENTRY_TTL_EXTEND);
}

fn get_listing(env: &Env, id: u32) -> Listing {
    let key = DataKey::Listing(id);
    let listing = env
        .storage()
        .persistent()
        .get(&key)
        .unwrap_or_else(|| panic_with(env, Error::NotFound));
    env.storage()
        .persistent()
        .extend_ttl(&key, ENTRY_TTL_THRESHOLD, ENTRY_TTL_EXTEND);
    listing
}

fn get_offer(env: &Env, id: u32) -> Offer {
    let key = DataKey::Offer(id);
    let offer = env
        .storage()
        .persistent()
        .get(&key)
        .unwrap_or_else(|| panic_with(env, Error::NotFound));
    env.storage()
        .persistent()
        .extend_ttl(&key, ENTRY_TTL_THRESHOLD, ENTRY_TTL_EXTEND);
    offer
}

fn get_order(env: &Env, id: u32) -> Order {
    let key = DataKey::Order(id);
    let order = env
        .storage()
        .persistent()
        .get(&key)
        .unwrap_or_else(|| panic_with(env, Error::NotFound));
    env.storage()
        .persistent()
        .extend_ttl(&key, ENTRY_TTL_THRESHOLD, ENTRY_TTL_EXTEND);
    order
}

fn panic_with(env: &Env, err: Error) -> ! {
    panic_with_error!(env, err)
}

mod test;
