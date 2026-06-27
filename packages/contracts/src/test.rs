#![cfg(test)]

use crate::{Marketplace, MarketplaceClient};
use soroban_sdk::{testutils::Address as _, testutils::Ledger as _, token, Address, Env};

const ONE_CARD: i128 = 10_000_000;
const USDC: i128 = 10_000_000; // 1 USDC in stroops
const FEE_BPS: u32 = 200; // 2%
const MAX_ROYALTY_BPS: u32 = 1000; // 10% ceiling
const ROYALTY_BPS: u32 = 500; // 5%

// Fulfillment modes (mirror the contract constants).
const DIGITAL: u32 = 0;
const PHYSICAL: u32 = 1;

// Confirmation window (seconds) — must match `CONFIRM_WINDOW_SECS` in lib.rs.
const CONFIRM_WINDOW_SECS: u64 = 1_209_600;

struct Fixture {
    env: Env,
    client: MarketplaceClient<'static>,
    card: Address,
    usdc: Address,
    usdc_token: token::TokenClient<'static>,
    card_token: token::TokenClient<'static>,
    seller: Address,
    buyer: Address,
    platform: Address,
    creator: Address,
}

fn setup() -> Fixture {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let platform = Address::generate(&env);
    let arbiter = Address::generate(&env);
    let seller = Address::generate(&env);
    let buyer = Address::generate(&env);
    let creator = Address::generate(&env);

    // Card SAC: mint copies to the seller.
    let card_issuer = Address::generate(&env);
    let card_sac = env.register_stellar_asset_contract_v2(card_issuer);
    let card = card_sac.address();
    token::StellarAssetClient::new(&env, &card).mint(&seller, &(3 * ONE_CARD));

    // USDC SAC: mint funds to the buyer.
    let usdc_issuer = Address::generate(&env);
    let usdc_sac = env.register_stellar_asset_contract_v2(usdc_issuer);
    let usdc = usdc_sac.address();
    token::StellarAssetClient::new(&env, &usdc).mint(&buyer, &(1000 * USDC));

    let contract_id = env.register(Marketplace, ());
    let client = MarketplaceClient::new(&env, &contract_id);
    client.init(&admin, &platform, &arbiter, &usdc, &FEE_BPS, &MAX_ROYALTY_BPS);

    Fixture {
        card_token: token::TokenClient::new(&env, &card),
        usdc_token: token::TokenClient::new(&env, &usdc),
        env,
        client,
        card,
        usdc,
        seller,
        buyer,
        platform,
        creator,
    }
}

#[test]
fn offer_then_accept_settles_atomically_with_fee() {
    let f = setup();
    let price = 50 * USDC;
    let offer_amount = 40 * USDC;

    let listing_id = f.client.list(&f.seller, &f.card, &price, &DIGITAL);
    // Card moved into escrow.
    assert_eq!(f.card_token.balance(&f.client.address), ONE_CARD);

    let offer_id = f.client.make_offer(&f.buyer, &listing_id, &offer_amount);
    // USDC moved into escrow.
    assert_eq!(f.usdc_token.balance(&f.client.address), offer_amount);

    f.client.accept_offer(&f.seller, &offer_id);

    let fee = offer_amount * (FEE_BPS as i128) / 10_000; // 0.8 USDC
    assert_eq!(
        f.card_token.balance(&f.buyer),
        ONE_CARD,
        "buyer receives card"
    );
    assert_eq!(
        f.usdc_token.balance(&f.seller),
        offer_amount - fee,
        "seller receives minus fee"
    );
    assert_eq!(
        f.usdc_token.balance(&f.platform),
        fee,
        "platform receives fee"
    );
    // Escrow drained.
    assert_eq!(f.usdc_token.balance(&f.client.address), 0);
    assert_eq!(f.card_token.balance(&f.client.address), 0);
}

#[test]
fn withdraw_offer_refunds_buyer() {
    let f = setup();
    let listing_id = f.client.list(&f.seller, &f.card, &(50 * USDC), &DIGITAL);
    let before = f.usdc_token.balance(&f.buyer);
    let offer_id = f.client.make_offer(&f.buyer, &listing_id, &(40 * USDC));
    assert_eq!(f.usdc_token.balance(&f.buyer), before - 40 * USDC);

    f.client.withdraw_offer(&f.buyer, &offer_id);
    assert_eq!(f.usdc_token.balance(&f.buyer), before, "full refund");
    assert_eq!(f.usdc_token.balance(&f.client.address), 0);
}

#[test]
fn buy_now_settles_at_asking_price() {
    let f = setup();
    let price = 60 * USDC;
    let listing_id = f.client.list(&f.seller, &f.card, &price, &DIGITAL);

    f.client.buy_now(&f.buyer, &listing_id);

    let fee = price * (FEE_BPS as i128) / 10_000;
    assert_eq!(f.card_token.balance(&f.buyer), ONE_CARD);
    assert_eq!(f.usdc_token.balance(&f.seller), price - fee);
    assert_eq!(f.usdc_token.balance(&f.platform), fee);
}

#[test]
fn cancel_listing_returns_card() {
    let f = setup();
    let before = f.card_token.balance(&f.seller);
    let listing_id = f.client.list(&f.seller, &f.card, &(50 * USDC), &DIGITAL);
    assert_eq!(f.card_token.balance(&f.seller), before - ONE_CARD);

    f.client.cancel_listing(&f.seller, &listing_id);
    assert_eq!(f.card_token.balance(&f.seller), before, "card returned");
}

#[test]
fn cannot_withdraw_after_settlement() {
    let f = setup();
    let listing_id = f.client.list(&f.seller, &f.card, &(50 * USDC), &DIGITAL);
    let offer_id = f.client.make_offer(&f.buyer, &listing_id, &(50 * USDC));
    f.client.accept_offer(&f.seller, &offer_id);

    // Offer is settled; withdrawing must fail.
    let res = f.client.try_withdraw_offer(&f.buyer, &offer_id);
    assert!(res.is_err());
}

#[test]
fn non_seller_cannot_cancel() {
    let f = setup();
    let listing_id = f.client.list(&f.seller, &f.card, &(50 * USDC), &DIGITAL);
    let res = f.client.try_cancel_listing(&f.buyer, &listing_id);
    assert!(res.is_err());
}

#[test]
fn buyer_cannot_buy_own_listing() {
    let f = setup();
    // Give the seller USDC so a self-buy would otherwise have funds to settle.
    token::StellarAssetClient::new(&f.env, &f.usdc).mint(&f.seller, &(100 * USDC));
    let listing_id = f.client.list(&f.seller, &f.card, &(50 * USDC), &DIGITAL);
    let res = f.client.try_buy_now(&f.seller, &listing_id);
    assert!(res.is_err(), "self-trade must be rejected");
}

#[test]
fn set_royalty_rejects_above_cap_and_unauthorized() {
    let f = setup();
    // Above the initialized ceiling is rejected.
    let res = f
        .client
        .try_set_royalty(&f.card, &f.creator, &(MAX_ROYALTY_BPS + 1));
    assert!(res.is_err(), "rate above cap must be rejected");
    // At the cap is accepted and stored.
    f.client.set_royalty(&f.card, &f.creator, &MAX_ROYALTY_BPS);
    assert_eq!(f.client.get_royalty_view(&f.card).bps, MAX_ROYALTY_BPS);

    // With no authorization available, the admin gate rejects the call.
    f.env.set_auths(&[]);
    let res = f.client.try_set_royalty(&f.card, &f.creator, &ROYALTY_BPS);
    assert!(res.is_err(), "non-admin caller must be rejected");
}

#[test]
fn accept_offer_splits_three_ways_with_royalty() {
    let f = setup();
    f.client.set_royalty(&f.card, &f.creator, &ROYALTY_BPS);
    let offer_amount = 40 * USDC;

    let listing_id = f.client.list(&f.seller, &f.card, &(50 * USDC), &DIGITAL);
    let offer_id = f.client.make_offer(&f.buyer, &listing_id, &offer_amount);
    f.client.accept_offer(&f.seller, &offer_id);

    let fee = offer_amount * (FEE_BPS as i128) / 10_000;
    let royalty = offer_amount * (ROYALTY_BPS as i128) / 10_000;
    assert_eq!(f.card_token.balance(&f.buyer), ONE_CARD, "buyer gets card");
    assert_eq!(
        f.usdc_token.balance(&f.seller),
        offer_amount - fee - royalty,
        "seller gets amount minus fee and royalty"
    );
    assert_eq!(f.usdc_token.balance(&f.platform), fee, "platform fee");
    assert_eq!(f.usdc_token.balance(&f.creator), royalty, "creator royalty");
    assert_eq!(f.usdc_token.balance(&f.client.address), 0, "escrow drained");
}

#[test]
fn buy_now_splits_three_ways_with_royalty() {
    let f = setup();
    f.client.set_royalty(&f.card, &f.creator, &ROYALTY_BPS);
    let price = 60 * USDC;

    let listing_id = f.client.list(&f.seller, &f.card, &price, &DIGITAL);
    f.client.buy_now(&f.buyer, &listing_id);

    let fee = price * (FEE_BPS as i128) / 10_000;
    let royalty = price * (ROYALTY_BPS as i128) / 10_000;
    assert_eq!(f.card_token.balance(&f.buyer), ONE_CARD);
    assert_eq!(f.usdc_token.balance(&f.seller), price - fee - royalty);
    assert_eq!(f.usdc_token.balance(&f.platform), fee);
    assert_eq!(f.usdc_token.balance(&f.creator), royalty);
}

#[test]
fn primary_sale_takes_no_royalty() {
    let f = setup();
    // The creator is the seller -> this is a primary sale.
    f.client.set_royalty(&f.card, &f.seller, &ROYALTY_BPS);
    let price = 50 * USDC;

    let listing_id = f.client.list(&f.seller, &f.card, &price, &DIGITAL);
    f.client.buy_now(&f.buyer, &listing_id);

    let fee = price * (FEE_BPS as i128) / 10_000;
    assert_eq!(
        f.usdc_token.balance(&f.seller),
        price - fee,
        "seller keeps everything but the platform fee"
    );
    assert_eq!(f.usdc_token.balance(&f.platform), fee);
}

#[test]
fn card_without_royalty_settles_two_ways() {
    let f = setup();
    // No royalty registered for this card.
    let price = 50 * USDC;

    let listing_id = f.client.list(&f.seller, &f.card, &price, &DIGITAL);
    f.client.buy_now(&f.buyer, &listing_id);

    let fee = price * (FEE_BPS as i128) / 10_000;
    assert_eq!(f.usdc_token.balance(&f.seller), price - fee);
    assert_eq!(f.usdc_token.balance(&f.platform), fee);
    assert_eq!(f.usdc_token.balance(&f.creator), 0, "no royalty taken");
}

#[test]
fn buy_now_settles_for_contract_address_buyer() {
    // A passkey smart wallet is a contract account (a `C…` address), not a
    // classic `G…` key. The buyer is plain `Address`, so settlement must work
    // identically when the buyer is a contract: `require_auth` and the USDC SAC
    // transfer are Address-generic. This guards against any classic-only
    // assumption sneaking into `buy_now`.
    let f = setup();
    let wallet: Address = f.env.register(Marketplace, ());
    token::StellarAssetClient::new(&f.env, &f.usdc).mint(&wallet, &(1000 * USDC));

    let price = 60 * USDC;
    let listing_id = f.client.list(&f.seller, &f.card, &price, &DIGITAL);
    f.client.buy_now(&wallet, &listing_id);

    let fee = price * (FEE_BPS as i128) / 10_000;
    assert_eq!(
        f.card_token.balance(&wallet),
        ONE_CARD,
        "contract-address buyer receives the card"
    );
    assert_eq!(f.usdc_token.balance(&f.seller), price - fee);
    assert_eq!(f.usdc_token.balance(&f.platform), fee);
}

#[test]
fn make_offer_accepts_from_contract_address_buyer() {
    // Same Address-generic guarantee for the offer/accept path: a contract
    // account can escrow USDC via `make_offer` and receive the card on settle.
    let f = setup();
    let wallet: Address = f.env.register(Marketplace, ());
    token::StellarAssetClient::new(&f.env, &f.usdc).mint(&wallet, &(1000 * USDC));

    let price = 50 * USDC;
    let offer_amount = 40 * USDC;
    let listing_id = f.client.list(&f.seller, &f.card, &price, &DIGITAL);
    let offer_id = f.client.make_offer(&wallet, &listing_id, &offer_amount);
    assert_eq!(
        f.usdc_token.balance(&f.client.address),
        offer_amount,
        "contract-address buyer's USDC is escrowed"
    );

    f.client.accept_offer(&f.seller, &offer_id);
    let fee = offer_amount * (FEE_BPS as i128) / 10_000;
    assert_eq!(
        f.card_token.balance(&wallet),
        ONE_CARD,
        "contract-address buyer receives the card on settle"
    );
    assert_eq!(f.usdc_token.balance(&f.seller), offer_amount - fee);
    assert_eq!(f.usdc_token.balance(&f.platform), fee);
}

// --- physical escrow: purchase / ship / confirm / timeout / dispute / resolve ---

#[test]
fn physical_purchase_then_confirm_releases_to_seller() {
    let f = setup();
    let price = 50 * USDC;
    let listing_id = f.client.list(&f.seller, &f.card, &price, &PHYSICAL);

    let order_id = f.client.purchase_escrow(&f.buyer, &listing_id);
    // Funds locked in custody; card still in custody (not yet delivered).
    assert_eq!(f.usdc_token.balance(&f.client.address), price, "USDC escrowed");
    assert_eq!(
        f.card_token.balance(&f.buyer),
        0,
        "card not delivered before confirmation"
    );

    // Seller ships, buyer confirms receipt.
    f.client.mark_shipped(&f.seller, &order_id);
    f.client.confirm_receipt(&f.buyer, &order_id);

    let fee = price * (FEE_BPS as i128) / 10_000;
    assert_eq!(f.card_token.balance(&f.buyer), ONE_CARD, "buyer gets card");
    assert_eq!(f.usdc_token.balance(&f.seller), price - fee, "seller paid");
    assert_eq!(f.usdc_token.balance(&f.platform), fee);
    assert_eq!(f.usdc_token.balance(&f.client.address), 0, "escrow drained");
    assert_eq!(f.card_token.balance(&f.client.address), 0);
}

#[test]
fn physical_timeout_releases_to_seller() {
    let f = setup();
    let price = 50 * USDC;
    let listing_id = f.client.list(&f.seller, &f.card, &price, &PHYSICAL);
    let order_id = f.client.purchase_escrow(&f.buyer, &listing_id);

    // Before the window elapses, a timeout claim is rejected.
    let early = f.client.try_claim_timeout(&order_id);
    assert!(early.is_err(), "timeout before deadline must fail");

    // Advance past the confirmation window; anyone can now release to the seller.
    f.env
        .ledger()
        .set_timestamp(f.env.ledger().timestamp() + CONFIRM_WINDOW_SECS + 1);
    f.client.claim_timeout(&order_id);

    let fee = price * (FEE_BPS as i128) / 10_000;
    assert_eq!(f.card_token.balance(&f.buyer), ONE_CARD);
    assert_eq!(f.usdc_token.balance(&f.seller), price - fee);
    assert_eq!(f.usdc_token.balance(&f.client.address), 0, "escrow drained");
}

#[test]
fn dispute_then_resolve_refund_returns_funds_and_card() {
    let f = setup();
    let price = 50 * USDC;
    let before = f.usdc_token.balance(&f.buyer);
    let seller_card_before = f.card_token.balance(&f.seller);

    let listing_id = f.client.list(&f.seller, &f.card, &price, &PHYSICAL);
    let order_id = f.client.purchase_escrow(&f.buyer, &listing_id);
    f.client.dispute(&f.buyer, &order_id);

    // Arbiter rules for the buyer: full refund, card back to seller.
    f.client.resolve(&order_id, &true);

    assert_eq!(f.usdc_token.balance(&f.buyer), before, "buyer fully refunded");
    assert_eq!(f.usdc_token.balance(&f.seller), 0, "seller paid nothing");
    assert_eq!(
        f.card_token.balance(&f.seller),
        seller_card_before,
        "card returned to seller"
    );
    assert_eq!(f.usdc_token.balance(&f.client.address), 0, "escrow drained");
    assert_eq!(f.card_token.balance(&f.client.address), 0);
}

#[test]
fn dispute_then_resolve_release_pays_seller() {
    let f = setup();
    let price = 50 * USDC;
    let listing_id = f.client.list(&f.seller, &f.card, &price, &PHYSICAL);
    let order_id = f.client.purchase_escrow(&f.buyer, &listing_id);
    f.client.dispute(&f.seller, &order_id);

    // Arbiter rules for the seller: release funds, deliver card to buyer.
    f.client.resolve(&order_id, &false);

    let fee = price * (FEE_BPS as i128) / 10_000;
    assert_eq!(f.card_token.balance(&f.buyer), ONE_CARD);
    assert_eq!(f.usdc_token.balance(&f.seller), price - fee);
    assert_eq!(f.usdc_token.balance(&f.platform), fee);
}

#[test]
fn cannot_confirm_or_timeout_while_disputed() {
    let f = setup();
    let listing_id = f.client.list(&f.seller, &f.card, &(50 * USDC), &PHYSICAL);
    let order_id = f.client.purchase_escrow(&f.buyer, &listing_id);
    f.client.dispute(&f.buyer, &order_id);

    assert!(
        f.client.try_confirm_receipt(&f.buyer, &order_id).is_err(),
        "confirm blocked while disputed"
    );
    f.env
        .ledger()
        .set_timestamp(f.env.ledger().timestamp() + CONFIRM_WINDOW_SECS + 1);
    assert!(
        f.client.try_claim_timeout(&order_id).is_err(),
        "timeout blocked while disputed"
    );
}

#[test]
fn non_participant_cannot_dispute() {
    let f = setup();
    let outsider = Address::generate(&f.env);
    let listing_id = f.client.list(&f.seller, &f.card, &(50 * USDC), &PHYSICAL);
    let order_id = f.client.purchase_escrow(&f.buyer, &listing_id);
    assert!(f.client.try_dispute(&outsider, &order_id).is_err());
}

#[test]
fn resolve_requires_dispute_state() {
    let f = setup();
    let listing_id = f.client.list(&f.seller, &f.card, &(50 * USDC), &PHYSICAL);
    let order_id = f.client.purchase_escrow(&f.buyer, &listing_id);
    // Not disputed yet -> arbiter cannot resolve.
    assert!(f.client.try_resolve(&order_id, &true).is_err());
}

#[test]
fn buy_now_rejects_physical_listing() {
    let f = setup();
    let listing_id = f.client.list(&f.seller, &f.card, &(50 * USDC), &PHYSICAL);
    assert!(
        f.client.try_buy_now(&f.buyer, &listing_id).is_err(),
        "physical listing must not settle through buy_now"
    );
}

#[test]
fn purchase_escrow_rejects_digital_listing() {
    let f = setup();
    let listing_id = f.client.list(&f.seller, &f.card, &(50 * USDC), &DIGITAL);
    assert!(
        f.client.try_purchase_escrow(&f.buyer, &listing_id).is_err(),
        "digital listing must not use the escrow path"
    );
}

#[test]
fn paused_blocks_new_trades_but_allows_exits() {
    let f = setup();
    let listing_id = f.client.list(&f.seller, &f.card, &(50 * USDC), &PHYSICAL);
    let order_id = f.client.purchase_escrow(&f.buyer, &listing_id);

    f.client.set_paused(&true);
    // New trades blocked.
    let l2 = f.client.try_list(&f.seller, &f.card, &(10 * USDC), &DIGITAL);
    assert!(l2.is_err(), "listing blocked while paused");
    // Exit path still works: buyer can confirm and drain the escrow.
    f.client.confirm_receipt(&f.buyer, &order_id);
    assert_eq!(f.card_token.balance(&f.buyer), ONE_CARD);
}

// --- auctions: create / bid / outbid / anti-snipe / settle / cancel / refund ---

// Auction status codes (mirror the contract's `AUCTION_*` constants).
const AUCTION_OPEN: u32 = 0;
const AUCTION_SETTLED: u32 = 1;
const AUCTION_CANCELLED: u32 = 2;
const AUCTION_NO_WINNER: u32 = 3;
const ANTI_SNIPE_SECS: u64 = 300;

/// Generate a second, funded bidder for outbid scenarios.
fn funded_bidder(f: &Fixture) -> Address {
    let bidder = Address::generate(&f.env);
    token::StellarAssetClient::new(&f.env, &f.usdc).mint(&bidder, &(1000 * USDC));
    bidder
}

#[test]
fn test_create_auction_success() {
    let f = setup();
    let before = f.card_token.balance(&f.seller);
    let id = f
        .client
        .create_auction(&f.seller, &f.card, &(10 * USDC), &(20 * USDC), &3600);

    // Card escrowed, auction recorded open with no bids.
    assert_eq!(f.card_token.balance(&f.client.address), ONE_CARD, "card escrowed");
    assert_eq!(f.card_token.balance(&f.seller), before - ONE_CARD);
    let auction = f.client.get_auction_view(&id);
    assert_eq!(auction.status, AUCTION_OPEN);
    assert_eq!(auction.high_bid, 0);
    assert_eq!(auction.start_price, 10 * USDC);

    // `auction_created` event emitted.
    let topic = soroban_sdk::Symbol::new(&f.env, "auction_created");
    assert!(
        f.env.events().all().iter().any(|(_, t, _)| {
            t.get(0) == Some(topic.clone().into_val(&f.env))
        }),
        "auction_created emitted"
    );
}

#[test]
fn test_create_auction_no_card() {
    let f = setup();
    let stranger = Address::generate(&f.env);
    let res = f
        .client
        .try_create_auction(&stranger, &f.card, &(10 * USDC), &(20 * USDC), &3600);
    assert!(res.is_err(), "seller without the card cannot create an auction");
}

#[test]
fn test_place_bid_first() {
    let f = setup();
    let id = f
        .client
        .create_auction(&f.seller, &f.card, &(10 * USDC), &(10 * USDC), &3600);

    let before = f.usdc_token.balance(&f.buyer);
    f.client.place_bid(&f.buyer, &id, &(15 * USDC));

    assert_eq!(f.usdc_token.balance(&f.buyer), before - 15 * USDC, "bid escrowed from bidder");
    assert_eq!(f.usdc_token.balance(&f.client.address), 15 * USDC, "USDC in custody");
    let auction = f.client.get_auction_view(&id);
    assert_eq!(auction.high_bid, 15 * USDC);
    assert_eq!(auction.high_bidder, Some(f.buyer.clone()));
}

#[test]
fn test_place_bid_outbid() {
    let f = setup();
    let bidder2 = funded_bidder(&f);
    let id = f
        .client
        .create_auction(&f.seller, &f.card, &(10 * USDC), &(10 * USDC), &3600);

    let b1_before = f.usdc_token.balance(&f.buyer);
    f.client.place_bid(&f.buyer, &id, &(15 * USDC));
    f.client.place_bid(&bidder2, &id, &(20 * USDC));

    // Previous high bidder refunded in full; only the new bid sits in custody.
    assert_eq!(f.usdc_token.balance(&f.buyer), b1_before, "previous bidder refunded");
    assert_eq!(f.usdc_token.balance(&f.client.address), 20 * USDC, "only new bid escrowed");
    let auction = f.client.get_auction_view(&id);
    assert_eq!(auction.high_bid, 20 * USDC);
    assert_eq!(auction.high_bidder, Some(bidder2));
}

#[test]
fn test_place_bid_below_high() {
    let f = setup();
    let bidder2 = funded_bidder(&f);
    let id = f
        .client
        .create_auction(&f.seller, &f.card, &(10 * USDC), &(10 * USDC), &3600);
    f.client.place_bid(&f.buyer, &id, &(15 * USDC));
    // Equal to or below the current high bid is rejected.
    assert!(f.client.try_place_bid(&bidder2, &id, &(15 * USDC)).is_err());
    assert!(f.client.try_place_bid(&bidder2, &id, &(14 * USDC)).is_err());
}

#[test]
fn test_place_bid_self_trade() {
    let f = setup();
    token::StellarAssetClient::new(&f.env, &f.usdc).mint(&f.seller, &(100 * USDC));
    let id = f
        .client
        .create_auction(&f.seller, &f.card, &(10 * USDC), &(10 * USDC), &3600);
    assert!(
        f.client.try_place_bid(&f.seller, &id, &(15 * USDC)).is_err(),
        "seller cannot bid on their own auction"
    );
}

#[test]
fn test_antisnipe_extension() {
    let f = setup();
    let bidder2 = funded_bidder(&f);

    // Bid placed well before the final window leaves ends_at unchanged.
    let early = f
        .client
        .create_auction(&f.seller, &f.card, &(10 * USDC), &(10 * USDC), &3600);
    let ends_before = f.client.get_auction_view(&early).ends_at;
    f.client.place_bid(&f.buyer, &early, &(15 * USDC));
    assert_eq!(
        f.client.get_auction_view(&early).ends_at,
        ends_before,
        "early bid does not extend"
    );

    // Bid inside the final ANTI_SNIPE_SECS pushes the deadline out by 300s.
    let late = f
        .client
        .create_auction(&f.seller, &f.card, &(10 * USDC), &(10 * USDC), &600);
    let ends_late = f.client.get_auction_view(&late).ends_at;
    f.env.ledger().set_timestamp(ends_late - 100);
    f.client.place_bid(&bidder2, &late, &(15 * USDC));
    assert_eq!(
        f.client.get_auction_view(&late).ends_at,
        ends_late + ANTI_SNIPE_SECS,
        "late bid extends by 300s"
    );
}

#[test]
fn test_settle_auction_winner() {
    let f = setup();
    f.client.set_royalty(&f.card, &f.creator, &ROYALTY_BPS);
    let id = f
        .client
        .create_auction(&f.seller, &f.card, &(10 * USDC), &(20 * USDC), &3600);
    let bid = 30 * USDC;
    f.client.place_bid(&f.buyer, &id, &bid);

    // Advance past the deadline and settle (permissionless).
    f.env
        .ledger()
        .set_timestamp(f.client.get_auction_view(&id).ends_at + 1);
    f.client.settle_auction(&id);

    let fee = bid * (FEE_BPS as i128) / 10_000;
    let royalty = bid * (ROYALTY_BPS as i128) / 10_000;
    assert_eq!(f.card_token.balance(&f.buyer), ONE_CARD, "winner gets card");
    assert_eq!(f.usdc_token.balance(&f.seller), bid - fee - royalty, "seller net");
    assert_eq!(f.usdc_token.balance(&f.platform), fee, "platform fee");
    assert_eq!(f.usdc_token.balance(&f.creator), royalty, "creator royalty");
    assert_eq!(f.usdc_token.balance(&f.client.address), 0, "escrow drained");
    assert_eq!(f.client.get_auction_view(&id).status, AUCTION_SETTLED);
}

#[test]
fn test_settle_auction_no_reserve() {
    let f = setup();
    let seller_card_before = f.card_token.balance(&f.seller);
    let buyer_before = f.usdc_token.balance(&f.buyer);
    // Reserve above the only bid -> reserve not met.
    let id = f
        .client
        .create_auction(&f.seller, &f.card, &(10 * USDC), &(50 * USDC), &3600);
    f.client.place_bid(&f.buyer, &id, &(20 * USDC));

    f.env
        .ledger()
        .set_timestamp(f.client.get_auction_view(&id).ends_at + 1);
    f.client.settle_auction(&id);

    assert_eq!(f.card_token.balance(&f.seller), seller_card_before, "card returned to seller");
    assert_eq!(f.usdc_token.balance(&f.buyer), buyer_before, "bid refunded");
    assert_eq!(f.usdc_token.balance(&f.client.address), 0, "escrow drained");
    assert_eq!(f.client.get_auction_view(&id).status, AUCTION_NO_WINNER);
}

#[test]
fn test_settle_before_end() {
    let f = setup();
    let id = f
        .client
        .create_auction(&f.seller, &f.card, &(10 * USDC), &(10 * USDC), &3600);
    f.client.place_bid(&f.buyer, &id, &(15 * USDC));
    assert!(
        f.client.try_settle_auction(&id).is_err(),
        "settlement before ends_at is rejected"
    );
}

#[test]
fn test_cancel_auction_no_bids() {
    let f = setup();
    let before = f.card_token.balance(&f.seller);
    let id = f
        .client
        .create_auction(&f.seller, &f.card, &(10 * USDC), &(10 * USDC), &3600);
    f.client.cancel_auction(&f.seller, &id);
    assert_eq!(f.card_token.balance(&f.seller), before, "card returned");
    assert_eq!(f.client.get_auction_view(&id).status, AUCTION_CANCELLED);
}

#[test]
fn test_cancel_auction_with_bids() {
    let f = setup();
    let id = f
        .client
        .create_auction(&f.seller, &f.card, &(10 * USDC), &(10 * USDC), &3600);
    f.client.place_bid(&f.buyer, &id, &(15 * USDC));
    assert!(
        f.client.try_cancel_auction(&f.seller, &id).is_err(),
        "auction with bids cannot be cancelled"
    );
}

#[test]
fn test_claim_refund() {
    let f = setup();
    let bidder2 = funded_bidder(&f);
    let id = f
        .client
        .create_auction(&f.seller, &f.card, &(10 * USDC), &(10 * USDC), &3600);

    let b1_before = f.usdc_token.balance(&f.buyer);
    f.client.place_bid(&f.buyer, &id, &(15 * USDC));
    f.client.place_bid(&bidder2, &id, &(20 * USDC));
    // Auto-refund already returned the funds, so a claim is a safe no-op.
    f.client.claim_refund(&f.buyer, &id);
    assert_eq!(f.usdc_token.balance(&f.buyer), b1_before, "balance whole, claim is a no-op");

    // The current high bidder cannot claim while the auction is still open.
    assert!(
        f.client.try_claim_refund(&bidder2, &id).is_err(),
        "high bidder cannot claim before settlement"
    );
}
