#![cfg(test)]

use crate::{Marketplace, MarketplaceClient};
use soroban_sdk::{testutils::Address as _, token, Address, Env};

const ONE_CARD: i128 = 10_000_000;
const USDC: i128 = 10_000_000; // 1 USDC in stroops
const FEE_BPS: u32 = 200; // 2%
const MAX_ROYALTY_BPS: u32 = 1000; // 10% ceiling
const ROYALTY_BPS: u32 = 500; // 5%

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
    client.init(&admin, &platform, &usdc, &FEE_BPS, &MAX_ROYALTY_BPS);

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

    let listing_id = f.client.list(&f.seller, &f.card, &price);
    // Card moved into escrow.
    assert_eq!(f.card_token.balance(&f.client.address), ONE_CARD);

    let offer_id = f.client.make_offer(&f.buyer, &listing_id, &offer_amount);
    // USDC moved into escrow.
    assert_eq!(f.usdc_token.balance(&f.client.address), offer_amount);

    f.client.accept_offer(&f.seller, &offer_id);

    let fee = offer_amount * (FEE_BPS as i128) / 10_000; // 0.8 USDC
    assert_eq!(f.card_token.balance(&f.buyer), ONE_CARD, "buyer receives card");
    assert_eq!(f.usdc_token.balance(&f.seller), offer_amount - fee, "seller receives minus fee");
    assert_eq!(f.usdc_token.balance(&f.platform), fee, "platform receives fee");
    // Escrow drained.
    assert_eq!(f.usdc_token.balance(&f.client.address), 0);
    assert_eq!(f.card_token.balance(&f.client.address), 0);
}

#[test]
fn withdraw_offer_refunds_buyer() {
    let f = setup();
    let listing_id = f.client.list(&f.seller, &f.card, &(50 * USDC));
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
    let listing_id = f.client.list(&f.seller, &f.card, &price);

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
    let listing_id = f.client.list(&f.seller, &f.card, &(50 * USDC));
    assert_eq!(f.card_token.balance(&f.seller), before - ONE_CARD);

    f.client.cancel_listing(&f.seller, &listing_id);
    assert_eq!(f.card_token.balance(&f.seller), before, "card returned");
}

#[test]
fn cannot_withdraw_after_settlement() {
    let f = setup();
    let listing_id = f.client.list(&f.seller, &f.card, &(50 * USDC));
    let offer_id = f.client.make_offer(&f.buyer, &listing_id, &(50 * USDC));
    f.client.accept_offer(&f.seller, &offer_id);

    // Offer is settled; withdrawing must fail.
    let res = f.client.try_withdraw_offer(&f.buyer, &offer_id);
    assert!(res.is_err());
}

#[test]
fn non_seller_cannot_cancel() {
    let f = setup();
    let listing_id = f.client.list(&f.seller, &f.card, &(50 * USDC));
    let res = f.client.try_cancel_listing(&f.buyer, &listing_id);
    assert!(res.is_err());
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

    let listing_id = f.client.list(&f.seller, &f.card, &(50 * USDC));
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

    let listing_id = f.client.list(&f.seller, &f.card, &price);
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

    let listing_id = f.client.list(&f.seller, &f.card, &price);
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

    let listing_id = f.client.list(&f.seller, &f.card, &price);
    f.client.buy_now(&f.buyer, &listing_id);

    let fee = price * (FEE_BPS as i128) / 10_000;
    assert_eq!(f.usdc_token.balance(&f.seller), price - fee);
    assert_eq!(f.usdc_token.balance(&f.platform), fee);
    assert_eq!(f.usdc_token.balance(&f.creator), 0, "no royalty taken");
}
