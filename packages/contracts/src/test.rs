#![cfg(test)]

use crate::{Marketplace, MarketplaceClient};
use card_collection::{CardCollection, CardCollectionClient};
use soroban_sdk::{testutils::Address as _, testutils::Ledger as _, token, vec, Address, Env, String};
use stellar_tokens::non_fungible::NonFungibleTokenClient;

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
    collection_client: CardCollectionClient<'static>,
    nft: NonFungibleTokenClient<'static>,
    /// The fixture's default card: minted to the seller with no royalty.
    card: u32,
    usdc: Address,
    usdc_token: token::TokenClient<'static>,
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
    let collection_owner = Address::generate(&env);

    // Card collection: every card copy across the marketplace is one token in
    // this single NFT contract.
    let collection = env.register(
        CardCollection,
        (
            collection_owner,
            String::from_str(&env, "https://example.com/"),
            String::from_str(&env, "TopDeck Cards"),
            String::from_str(&env, "CARD"),
        ),
    );
    let collection_client = CardCollectionClient::new(&env, &collection);
    let nft = NonFungibleTokenClient::new(&env, &collection);

    // Mint the fixture's default card (no royalty) to the seller.
    let card = collection_client.mint(&seller, &seller, &0);

    // USDC SAC: mint funds to the buyer.
    let usdc_issuer = Address::generate(&env);
    let usdc_sac = env.register_stellar_asset_contract_v2(usdc_issuer);
    let usdc = usdc_sac.address();
    token::StellarAssetClient::new(&env, &usdc).mint(&buyer, &(1000 * USDC));

    let contract_id = env.register(Marketplace, ());
    let client = MarketplaceClient::new(&env, &contract_id);
    client.init(
        &admin,
        &platform,
        &arbiter,
        &usdc,
        &FEE_BPS,
        &MAX_ROYALTY_BPS,
        &collection,
    );

    Fixture {
        usdc_token: token::TokenClient::new(&env, &usdc),
        env,
        client,
        collection_client,
        nft,
        card,
        usdc,
        seller,
        buyer,
        platform,
        creator,
    }
}

/// Mint a fresh, royalty-free card to `owner`. Used for a swap counterparty's
/// get-side card, or any extra card a test needs beyond the fixture's default.
fn new_card(f: &Fixture, owner: &Address) -> u32 {
    f.collection_client.mint(owner, owner, &0)
}

#[test]
fn offer_then_accept_settles_atomically_with_fee() {
    let f = setup();
    let price = 50 * USDC;
    let offer_amount = 40 * USDC;

    let listing_id = f.client.list(&f.seller, &f.card, &price, &DIGITAL);
    // Card moved into escrow.
    assert_eq!(f.nft.owner_of(&f.card), f.client.address);

    let offer_id = f.client.make_offer(&f.buyer, &listing_id, &offer_amount);
    // USDC moved into escrow.
    assert_eq!(f.usdc_token.balance(&f.client.address), offer_amount);

    f.client.accept_offer(&f.seller, &offer_id);

    let fee = offer_amount * (FEE_BPS as i128) / 10_000; // 0.8 USDC
    assert_eq!(f.nft.owner_of(&f.card), f.buyer, "buyer receives card");
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
    assert_eq!(f.nft.owner_of(&f.card), f.buyer);
    assert_eq!(f.usdc_token.balance(&f.seller), price - fee);
    assert_eq!(f.usdc_token.balance(&f.platform), fee);
}

#[test]
fn cancel_listing_returns_card() {
    let f = setup();
    let listing_id = f.client.list(&f.seller, &f.card, &(50 * USDC), &DIGITAL);
    assert_eq!(f.nft.owner_of(&f.card), f.client.address, "card escrowed");

    f.client.cancel_listing(&f.seller, &listing_id);
    assert_eq!(f.nft.owner_of(&f.card), f.seller, "card returned");
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
fn list_clamps_royalty_above_ceiling() {
    let f = setup();
    // Royalties are immutable once minted — there is no admin-side registry
    // left to reject an over-cap rate at registration time. Instead, `list`
    // clamps the snapshot down to `max_royalty_bps` (fixed at `init`).
    let card = f
        .collection_client
        .mint(&f.seller, &f.creator, &(MAX_ROYALTY_BPS + 500));
    let listing_id = f.client.list(&f.seller, &card, &(50 * USDC), &DIGITAL);
    let listing = f.client.get_listing_view(&listing_id);
    assert_eq!(
        listing.royalty_bps, MAX_ROYALTY_BPS,
        "snapshot clamped to the marketplace's ceiling"
    );
    assert_eq!(listing.creator, f.creator);
}

#[test]
fn listing_snapshot_is_immutable_after_mint() {
    let f = setup();
    // A token's royalty is fixed forever at mint (no setter exists on the
    // collection contract). Minting two cards with different rates and
    // listing both proves each listing's snapshot reflects its own token's
    // mint-time royalty, and one can't be perturbed by the other.
    let card_a = f.collection_client.mint(&f.seller, &f.creator, &ROYALTY_BPS);
    let card_b = f.collection_client.mint(&f.seller, &f.creator, &(ROYALTY_BPS * 2));

    let listing_a = f.client.list(&f.seller, &card_a, &(50 * USDC), &DIGITAL);
    let listing_b = f.client.list(&f.seller, &card_b, &(50 * USDC), &DIGITAL);

    assert_eq!(f.client.get_listing_view(&listing_a).royalty_bps, ROYALTY_BPS);
    assert_eq!(
        f.client.get_listing_view(&listing_b).royalty_bps,
        ROYALTY_BPS * 2
    );
}

#[test]
fn accept_offer_splits_three_ways_with_royalty() {
    let f = setup();
    let card = f.collection_client.mint(&f.seller, &f.creator, &ROYALTY_BPS);
    let offer_amount = 40 * USDC;

    let listing_id = f.client.list(&f.seller, &card, &(50 * USDC), &DIGITAL);
    let offer_id = f.client.make_offer(&f.buyer, &listing_id, &offer_amount);
    f.client.accept_offer(&f.seller, &offer_id);

    let fee = offer_amount * (FEE_BPS as i128) / 10_000;
    let royalty = offer_amount * (ROYALTY_BPS as i128) / 10_000;
    assert_eq!(f.nft.owner_of(&card), f.buyer, "buyer gets card");
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
    let card = f.collection_client.mint(&f.seller, &f.creator, &ROYALTY_BPS);
    let price = 60 * USDC;

    let listing_id = f.client.list(&f.seller, &card, &price, &DIGITAL);
    f.client.buy_now(&f.buyer, &listing_id);

    let fee = price * (FEE_BPS as i128) / 10_000;
    let royalty = price * (ROYALTY_BPS as i128) / 10_000;
    assert_eq!(f.nft.owner_of(&card), f.buyer);
    assert_eq!(f.usdc_token.balance(&f.seller), price - fee - royalty);
    assert_eq!(f.usdc_token.balance(&f.platform), fee);
    assert_eq!(f.usdc_token.balance(&f.creator), royalty);
}

#[test]
fn primary_sale_takes_no_royalty() {
    let f = setup();
    // The creator is the seller -> this is a primary sale.
    let card = f.collection_client.mint(&f.seller, &f.seller, &ROYALTY_BPS);
    let price = 50 * USDC;

    let listing_id = f.client.list(&f.seller, &card, &price, &DIGITAL);
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
        f.nft.owner_of(&f.card),
        wallet,
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
        f.nft.owner_of(&f.card),
        wallet,
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
    assert_eq!(
        f.usdc_token.balance(&f.client.address),
        price,
        "USDC escrowed"
    );
    assert_eq!(
        f.nft.owner_of(&f.card),
        f.client.address,
        "card not delivered before confirmation"
    );

    // Seller ships, buyer confirms receipt.
    f.client.mark_shipped(&f.seller, &order_id);
    f.client.confirm_receipt(&f.buyer, &order_id);

    let fee = price * (FEE_BPS as i128) / 10_000;
    assert_eq!(f.nft.owner_of(&f.card), f.buyer, "buyer gets card");
    assert_eq!(f.usdc_token.balance(&f.seller), price - fee, "seller paid");
    assert_eq!(f.usdc_token.balance(&f.platform), fee);
    assert_eq!(f.usdc_token.balance(&f.client.address), 0, "escrow drained");
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
    assert_eq!(f.nft.owner_of(&f.card), f.buyer);
    assert_eq!(f.usdc_token.balance(&f.seller), price - fee);
    assert_eq!(f.usdc_token.balance(&f.client.address), 0, "escrow drained");
}

#[test]
fn dispute_then_resolve_refund_returns_funds_and_card() {
    let f = setup();
    let price = 50 * USDC;
    let before = f.usdc_token.balance(&f.buyer);

    let listing_id = f.client.list(&f.seller, &f.card, &price, &PHYSICAL);
    let order_id = f.client.purchase_escrow(&f.buyer, &listing_id);
    f.client.dispute(&f.buyer, &order_id);

    // Arbiter rules for the buyer: full refund, card back to seller.
    f.client.resolve(&order_id, &true);

    assert_eq!(
        f.usdc_token.balance(&f.buyer),
        before,
        "buyer fully refunded"
    );
    assert_eq!(f.usdc_token.balance(&f.seller), 0, "seller paid nothing");
    assert_eq!(f.nft.owner_of(&f.card), f.seller, "card returned to seller");
    assert_eq!(f.usdc_token.balance(&f.client.address), 0, "escrow drained");
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
    assert_eq!(f.nft.owner_of(&f.card), f.buyer);
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
    let l2 = f
        .client
        .try_list(&f.seller, &f.card, &(10 * USDC), &DIGITAL);
    assert!(l2.is_err(), "listing blocked while paused");
    // Exit path still works: buyer can confirm and drain the escrow.
    f.client.confirm_receipt(&f.buyer, &order_id);
    assert_eq!(f.nft.owner_of(&f.card), f.buyer);
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
    let id = f
        .client
        .create_auction(&f.seller, &f.card, &(10 * USDC), &(20 * USDC), &3600);

    // Card escrowed, auction recorded open with no bids.
    assert_eq!(f.nft.owner_of(&f.card), f.client.address, "card escrowed");
    let auction = f.client.get_auction_view(&id);
    assert_eq!(auction.status, AUCTION_OPEN);
    assert_eq!(auction.high_bid, 0);
    assert_eq!(auction.start_price, 10 * USDC);
    assert_eq!(auction.reserve_price, 20 * USDC);
    assert_eq!(auction.high_bidder, None);
}

#[test]
fn test_create_auction_no_card() {
    let f = setup();
    let stranger = Address::generate(&f.env);
    let res = f
        .client
        .try_create_auction(&stranger, &f.card, &(10 * USDC), &(20 * USDC), &3600);
    assert!(
        res.is_err(),
        "seller without the card cannot create an auction"
    );
}

#[test]
fn test_place_bid_first() {
    let f = setup();
    let id = f
        .client
        .create_auction(&f.seller, &f.card, &(10 * USDC), &(10 * USDC), &3600);

    let before = f.usdc_token.balance(&f.buyer);
    f.client.place_bid(&f.buyer, &id, &(15 * USDC));

    assert_eq!(
        f.usdc_token.balance(&f.buyer),
        before - 15 * USDC,
        "bid escrowed from bidder"
    );
    assert_eq!(
        f.usdc_token.balance(&f.client.address),
        15 * USDC,
        "USDC in custody"
    );
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
    assert_eq!(
        f.usdc_token.balance(&f.buyer),
        b1_before,
        "previous bidder refunded"
    );
    assert_eq!(
        f.usdc_token.balance(&f.client.address),
        20 * USDC,
        "only new bid escrowed"
    );
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
        f.client
            .try_place_bid(&f.seller, &id, &(15 * USDC))
            .is_err(),
        "seller cannot bid on their own auction"
    );
}

#[test]
fn test_antisnipe_extension() {
    let f = setup();
    let bidder2 = funded_bidder(&f);
    // Each auction escrows its card for its own lifetime, so this needs a
    // second, distinct card for the `late` auction.
    let card2 = new_card(&f, &f.seller);

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
        .create_auction(&f.seller, &card2, &(10 * USDC), &(10 * USDC), &600);
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
    let card = f.collection_client.mint(&f.seller, &f.creator, &ROYALTY_BPS);
    let id = f
        .client
        .create_auction(&f.seller, &card, &(10 * USDC), &(20 * USDC), &3600);
    let bid = 30 * USDC;
    f.client.place_bid(&f.buyer, &id, &bid);

    // Advance past the deadline and settle (permissionless).
    f.env
        .ledger()
        .set_timestamp(f.client.get_auction_view(&id).ends_at + 1);
    f.client.settle_auction(&id);

    let fee = bid * (FEE_BPS as i128) / 10_000;
    let royalty = bid * (ROYALTY_BPS as i128) / 10_000;
    assert_eq!(f.nft.owner_of(&card), f.buyer, "winner gets card");
    assert_eq!(
        f.usdc_token.balance(&f.seller),
        bid - fee - royalty,
        "seller net"
    );
    assert_eq!(f.usdc_token.balance(&f.platform), fee, "platform fee");
    assert_eq!(f.usdc_token.balance(&f.creator), royalty, "creator royalty");
    assert_eq!(f.usdc_token.balance(&f.client.address), 0, "escrow drained");
    assert_eq!(f.client.get_auction_view(&id).status, AUCTION_SETTLED);
}

#[test]
fn test_settle_auction_no_reserve() {
    let f = setup();
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

    assert_eq!(f.nft.owner_of(&f.card), f.seller, "card returned to seller");
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
    let id = f
        .client
        .create_auction(&f.seller, &f.card, &(10 * USDC), &(10 * USDC), &3600);
    f.client.cancel_auction(&f.seller, &id);
    assert_eq!(f.nft.owner_of(&f.card), f.seller, "card returned");
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
    assert_eq!(
        f.usdc_token.balance(&f.buyer),
        b1_before,
        "balance whole, claim is a no-op"
    );

    // The current high bidder cannot claim while the auction is still open.
    assert!(
        f.client.try_claim_refund(&bidder2, &id).is_err(),
        "high bidder cannot claim before settlement"
    );
}

// --- barter swap: propose / execute / cancel / decline ---

// Swap lifecycle codes (mirror the contract's `SWAP_*` constants).
const SWAP_PROPOSED: u32 = 10;
const SWAP_ACCEPTED: u32 = 11;
const SWAP_CANCELLED: u32 = 12;
const SWAP_DECLINED: u32 = 13;

#[test]
fn test_propose_swap_locks_cards() {
    let f = setup();
    // Bob (buyer) holds the get-side card.
    let card_b = new_card(&f, &f.buyer);
    let give = vec![&f.env, f.card];
    let get = vec![&f.env, card_b];

    let id = f.client.propose_swap(&f.seller, &f.buyer, &give, &get, &0);

    // Alice's give-side card moved into contract custody.
    assert_eq!(f.nft.owner_of(&f.card), f.client.address, "card escrowed");

    let view = f.client.get_swap_view(&id);
    assert_eq!(view.proposer, f.seller);
    assert_eq!(view.counterparty, f.buyer);
    assert_eq!(view.give_tokens, give);
    assert_eq!(view.get_tokens, get);
    assert_eq!(view.usdc_amount, 0);
    assert_eq!(view.status, SWAP_PROPOSED);
}

#[test]
fn test_execute_swap_atomic() {
    let f = setup();
    // Alice funds the USDC sweetener; Bob holds the get-side card.
    let sweetener = 100 * USDC;
    token::StellarAssetClient::new(&f.env, &f.usdc).mint(&f.seller, &sweetener);
    let card_b = new_card(&f, &f.buyer);

    let give = vec![&f.env, f.card];
    let get = vec![&f.env, card_b];
    let buyer_usdc_before = f.usdc_token.balance(&f.buyer);
    let id = f
        .client
        .propose_swap(&f.seller, &f.buyer, &give, &get, &sweetener);

    // Custody holds Alice's card + her sweetener until Bob accepts.
    assert_eq!(f.nft.owner_of(&f.card), f.client.address);
    assert_eq!(f.usdc_token.balance(&f.client.address), sweetener);

    f.client.execute_swap(&f.buyer, &id);

    let fee = sweetener * (FEE_BPS as i128) / 10_000; // 2 USDC
                                                       // Cards crossed: Bob gets card A, Alice gets card B.
    assert_eq!(f.nft.owner_of(&f.card), f.buyer, "Bob receives card A");
    assert_eq!(f.nft.owner_of(&card_b), f.seller, "Alice receives card B");
    // USDC sweetener split: platform fee + remainder to Bob.
    assert_eq!(f.usdc_token.balance(&f.platform), fee, "platform fee");
    assert_eq!(
        f.usdc_token.balance(&f.buyer),
        buyer_usdc_before + sweetener - fee,
        "Bob gets sweetener minus fee"
    );
    // Custody fully drained.
    assert_eq!(f.usdc_token.balance(&f.client.address), 0);
    assert_eq!(f.client.get_swap_view(&id).status, SWAP_ACCEPTED);
}

#[test]
fn test_execute_swap_no_usdc_no_fee() {
    let f = setup();
    let card_b = new_card(&f, &f.buyer);

    let give = vec![&f.env, f.card];
    let get = vec![&f.env, card_b];
    let id = f.client.propose_swap(&f.seller, &f.buyer, &give, &get, &0);
    f.client.execute_swap(&f.buyer, &id);

    // Pure card-for-card: cards cross, no USDC moves anywhere, no fee.
    assert_eq!(f.nft.owner_of(&f.card), f.buyer, "Bob receives card A");
    assert_eq!(f.nft.owner_of(&card_b), f.seller, "Alice receives card B");
    assert_eq!(
        f.usdc_token.balance(&f.platform),
        0,
        "no fee on a pure card swap"
    );
    assert_eq!(
        f.usdc_token.balance(&f.client.address),
        0,
        "no USDC in custody"
    );
    assert_eq!(f.client.get_swap_view(&id).usdc_amount, 0);
}

#[test]
fn test_cancel_swap_returns_cards() {
    let f = setup();
    let sweetener = 50 * USDC;
    token::StellarAssetClient::new(&f.env, &f.usdc).mint(&f.seller, &sweetener);
    let card_b = new_card(&f, &f.buyer);

    let usdc_before = f.usdc_token.balance(&f.seller);
    let give = vec![&f.env, f.card];
    let get = vec![&f.env, card_b];
    let id = f
        .client
        .propose_swap(&f.seller, &f.buyer, &give, &get, &sweetener);

    f.client.cancel_swap(&f.seller, &id);

    // Both the escrowed card and the sweetener return to Alice.
    assert_eq!(f.nft.owner_of(&f.card), f.seller, "card returned");
    assert_eq!(
        f.usdc_token.balance(&f.seller),
        usdc_before,
        "sweetener returned"
    );
    assert_eq!(f.client.get_swap_view(&id).status, SWAP_CANCELLED);
}

#[test]
fn test_decline_swap_returns_cards() {
    let f = setup();
    let card_b = new_card(&f, &f.buyer);

    let give = vec![&f.env, f.card];
    let get = vec![&f.env, card_b];
    let id = f.client.propose_swap(&f.seller, &f.buyer, &give, &get, &0);

    f.client.decline_swap(&f.buyer, &id);

    assert_eq!(f.nft.owner_of(&f.card), f.seller, "card returned to Alice");
    assert_eq!(f.client.get_swap_view(&id).status, SWAP_DECLINED);
}

#[test]
fn test_propose_swap_self_trade_rejected() {
    let f = setup();
    let give = vec![&f.env, f.card];
    let get = vec![&f.env, f.card];
    // Proposer == counterparty must be rejected before anything is escrowed.
    let res = f
        .client
        .try_propose_swap(&f.seller, &f.seller, &give, &get, &0);
    assert!(res.is_err(), "self-trade must be rejected");
}

#[test]
fn test_execute_swap_wrong_counterparty_rejected() {
    let f = setup();
    let card_b = new_card(&f, &f.buyer);
    let give = vec![&f.env, f.card];
    let get = vec![&f.env, card_b];
    let id = f.client.propose_swap(&f.seller, &f.buyer, &give, &get, &0);

    // A third party — not the named counterparty — cannot execute the swap.
    let stranger = Address::generate(&f.env);
    let res = f.client.try_execute_swap(&stranger, &id);
    assert!(res.is_err(), "only the named counterparty may execute");
    // The proposal is untouched and the card is still escrowed.
    assert_eq!(f.client.get_swap_view(&id).status, SWAP_PROPOSED);
    assert_eq!(f.nft.owner_of(&f.card), f.client.address);
}
