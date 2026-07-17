extern crate std;

use soroban_sdk::{testutils::Address as _, Address, Env, String};
use stellar_tokens::non_fungible::NonFungibleTokenClient;

use crate::{CardCollection, CardCollectionClient};

/// The contract exposes its custom entrypoints on `CardCollectionClient` and
/// the standard interface on `NonFungibleTokenClient`, both against the same
/// contract id.
fn setup(e: &Env) -> (CardCollectionClient<'_>, NonFungibleTokenClient<'_>, Address) {
    let owner = Address::generate(e);
    let id = e.register(
        CardCollection,
        (
            owner.clone(),
            String::from_str(e, "https://topdeck.example/cards/"),
            String::from_str(e, "TopDeck Cards"),
            String::from_str(e, "TOPDECK"),
        ),
    );
    (
        CardCollectionClient::new(e, &id),
        NonFungibleTokenClient::new(e, &id),
        owner,
    )
}

#[test]
fn mint_assigns_sequential_ids() {
    let e = Env::default();
    e.mock_all_auths();
    let (client, nft, _owner) = setup(&e);
    let holder = Address::generate(&e);
    let creator = Address::generate(&e);

    let a = client.mint(&holder, &creator, &0);
    let b = client.mint(&holder, &creator, &0);
    let c = client.mint(&holder, &creator, &0);

    assert_eq!(b, a + 1);
    assert_eq!(c, b + 1);
    assert_eq!(nft.owner_of(&a), holder);
    assert_eq!(nft.balance(&holder), 3);
}

#[test]
fn non_owner_mint_rejected() {
    let e = Env::default();
    let (client, nft, _owner) = setup(&e);
    let holder = Address::generate(&e);
    let creator = Address::generate(&e);

    // No auth is mocked, so the owner's require_auth cannot be satisfied.
    assert!(client.try_mint(&holder, &creator, &0).is_err());
}

#[test]
fn royalty_registered_at_mint() {
    let e = Env::default();
    e.mock_all_auths();
    let (client, nft, _owner) = setup(&e);
    let holder = Address::generate(&e);
    let creator = Address::generate(&e);

    let with_royalty = client.mint(&holder, &creator, &500);
    let (receiver, bps) = client.token_royalty(&with_royalty);
    assert_eq!(receiver, creator);
    assert_eq!(bps, 500);

    let without_royalty = client.mint(&holder, &creator, &0);
    let (_, bps) = client.token_royalty(&without_royalty);
    assert_eq!(bps, 0);
}

#[test]
fn transfer_moves_ownership() {
    let e = Env::default();
    e.mock_all_auths();
    let (client, nft, _owner) = setup(&e);
    let seller = Address::generate(&e);
    let buyer = Address::generate(&e);
    let creator = Address::generate(&e);

    let token_id = client.mint(&seller, &creator, &250);
    nft.transfer(&seller, &buyer, &token_id);

    assert_eq!(nft.owner_of(&token_id), buyer);
    assert_eq!(nft.balance(&seller), 0);
    assert_eq!(nft.balance(&buyer), 1);

    // Royalty survives the transfer unchanged.
    let (receiver, bps) = client.token_royalty(&token_id);
    assert_eq!(receiver, creator);
    assert_eq!(bps, 250);
}
