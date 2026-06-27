#![no_std]
//! Marketplace settlement contract.
//!
//! A single "lock asset until condition" escrow primitive that powers both
//! buy-now and offer/accept:
//!   - `list`           seller locks a card into contract custody
//!   - `make_offer`     buyer locks USDC into contract custody
//!   - `accept_offer`   atomic settlement: card -> buyer, USDC-fee -> seller, fee -> platform
//!   - `buy_now`        same settlement at the asking price
//!   - `cancel_listing` / `withdraw_offer` return escrowed value to its owner
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

const STATUS_OPEN: u32 = 0;
const STATUS_DONE: u32 = 1; // sold (listing) / settled (offer)
const STATUS_CANCELLED: u32 = 2; // cancelled (listing) / withdrawn (offer)

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

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Admin,
    Platform,
    Usdc,
    FeeBps,
    MaxRoyaltyBps,
    ListingCount,
    OfferCount,
    Listing(u32),
    Offer(u32),
    Royalty(Address),
}

#[contract]
pub struct Marketplace;

#[contractimpl]
impl Marketplace {
    // --- 3.2 init ---

    /// One-time setup: platform fee collector, USDC token, fee and the royalty
    /// ceiling, both in basis points. `fee_bps + max_royalty_bps` must stay below
    /// 100% so every settlement leaves the seller a non-negative share.
    pub fn init(
        env: Env,
        admin: Address,
        platform: Address,
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
        s.set(&DataKey::Usdc, &usdc_token);
        s.set(&DataKey::FeeBps, &fee_bps);
        s.set(&DataKey::MaxRoyaltyBps, &max_royalty_bps);
        s.set(&DataKey::ListingCount, &0u32);
        s.set(&DataKey::OfferCount, &0u32);
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

    // --- 3.3 list / cancel_listing ---

    /// Seller locks one card into escrow at `price` (USDC stroops). Returns the listing id.
    pub fn list(env: Env, seller: Address, card_token: Address, price: i128) -> u32 {
        require_init(&env);
        seller.require_auth();
        if price <= 0 {
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
        };
        env.storage()
            .persistent()
            .set(&DataKey::Listing(id), &listing);

        env.events()
            .publish((Symbol::new(&env, "list"), id), (seller, price));
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
        env.storage()
            .persistent()
            .set(&DataKey::Listing(listing_id), &listing);
        env.events()
            .publish((Symbol::new(&env, "cancel"), listing_id), seller);
    }

    // --- 3.4 make_offer / withdraw_offer ---

    /// Buyer locks USDC into escrow against a listing. Returns the offer id.
    pub fn make_offer(env: Env, buyer: Address, listing_id: u32, amount: i128) -> u32 {
        require_init(&env);
        buyer.require_auth();
        if amount <= 0 {
            panic_with(&env, Error::BadAmount);
        }
        let listing = get_listing(&env, listing_id);
        if listing.status != STATUS_OPEN {
            panic_with(&env, Error::NotOpen);
        }
        usdc(&env).transfer(&buyer, &env.current_contract_address(), &amount);

        let id = next_id(&env, &DataKey::OfferCount);
        let offer = Offer {
            buyer: buyer.clone(),
            listing_id,
            amount,
            status: STATUS_OPEN,
        };
        env.storage().persistent().set(&DataKey::Offer(id), &offer);

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
        env.storage()
            .persistent()
            .set(&DataKey::Offer(offer_id), &offer);
        env.events()
            .publish((Symbol::new(&env, "withdraw"), offer_id), buyer);
    }

    // --- 3.5 accept_offer (atomic settlement) ---

    /// Seller accepts an offer; settles atomically (card -> buyer, USDC-fee -> seller, fee -> platform).
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

        // Funds are already escrowed in the contract; distribute from custody.
        let contract = env.current_contract_address();
        let fee = split_fee(&env, offer.amount);
        let royalty = royalty_for(&env, &listing, offer.amount);
        let seller_amount = offer.amount - fee - royalty;
        let u = usdc(&env);
        u.transfer(&contract, &listing.seller, &seller_amount);
        if fee > 0 {
            u.transfer(&contract, &platform(&env), &fee);
        }
        if royalty > 0 {
            u.transfer(&contract, &listing.creator, &royalty);
        }
        token::TokenClient::new(&env, &listing.card_token).transfer(
            &contract,
            &offer.buyer,
            &ONE_CARD,
        );

        listing.status = STATUS_DONE;
        offer.status = STATUS_DONE;
        env.storage()
            .persistent()
            .set(&DataKey::Listing(offer.listing_id), &listing);
        env.storage()
            .persistent()
            .set(&DataKey::Offer(offer_id), &offer);

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

    // --- 3.6 buy_now (settlement at asking price) ---

    /// Buyer purchases at the listing's asking price; settles atomically.
    pub fn buy_now(env: Env, buyer: Address, listing_id: u32) {
        require_init(&env);
        buyer.require_auth();
        let mut listing = get_listing(&env, listing_id);
        if listing.status != STATUS_OPEN {
            panic_with(&env, Error::NotOpen);
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
        env.storage()
            .persistent()
            .set(&DataKey::Listing(listing_id), &listing);
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

    // --- views ---

    pub fn get_listing_view(env: Env, listing_id: u32) -> Listing {
        get_listing(&env, listing_id)
    }

    pub fn get_offer_view(env: Env, offer_id: u32) -> Offer {
        get_offer(&env, offer_id)
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

fn get_listing(env: &Env, id: u32) -> Listing {
    env.storage()
        .persistent()
        .get(&DataKey::Listing(id))
        .unwrap_or_else(|| panic_with(env, Error::NotFound))
}

fn get_offer(env: &Env, id: u32) -> Offer {
    env.storage()
        .persistent()
        .get(&DataKey::Offer(id))
        .unwrap_or_else(|| panic_with(env, Error::NotFound))
}

fn panic_with(env: &Env, err: Error) -> ! {
    panic_with_error!(env, err)
}

mod test;
