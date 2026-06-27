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
    Symbol,
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

    // --- views ---

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
    let contract = env.current_contract_address();
    let fee = split_fee(env, amount);
    let royalty = royalty_for(env, listing, amount);
    let seller_amount = amount - fee - royalty;
    let u = usdc(env);
    u.transfer(&contract, &listing.seller, &seller_amount);
    if fee > 0 {
        u.transfer(&contract, &platform(env), &fee);
    }
    if royalty > 0 {
        u.transfer(&contract, &listing.creator, &royalty);
    }
    token::TokenClient::new(env, &listing.card_token).transfer(&contract, buyer, &ONE_CARD);
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

fn put_order(env: &Env, id: u32, order: &Order) {
    let key = DataKey::Order(id);
    env.storage().persistent().set(&key, order);
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
