//! TopDeck Cards — the platform's global NFT collection.
//!
//! Every card copy across the marketplace is one token in this collection
//! (OpenZeppelin `non_fungible` Base variant). Minting is restricted to the
//! platform owner account; a token's creator royalty is registered at mint
//! and never changes afterwards (no setter is exposed), which is what lets
//! the settlement contract treat its list-time royalty snapshot as final.
#![no_std]

use soroban_sdk::{contract, contractimpl, Address, Env, String};
use stellar_access::ownable::{self as ownable, Ownable};
use stellar_macros::only_owner;
use stellar_tokens::non_fungible::{burnable::NonFungibleBurnable, Base, NonFungibleToken};

/// Probing `Base::royalty_info` with this sale price makes the returned
/// amount equal the royalty's basis points exactly (amount = price * bps / 10_000).
const BPS_PROBE_PRICE: i128 = 10_000;

#[contract]
pub struct CardCollection;

#[contractimpl]
impl CardCollection {
    pub fn __constructor(e: &Env, owner: Address, base_uri: String, name: String, symbol: String) {
        Base::set_metadata(e, base_uri, name, symbol);
        ownable::set_owner(e, &owner);
    }

    /// Mint the next card copy to `to`. A non-zero `royalty_bps` registers
    /// `creator` as the token's royalty payee. Returns the new token id.
    #[only_owner]
    pub fn mint(e: &Env, to: Address, creator: Address, royalty_bps: u32) -> u32 {
        let token_id = Base::sequential_mint(e, &to);
        if royalty_bps > 0 {
            Base::set_token_royalty(e, token_id, &creator, royalty_bps);
        }
        token_id
    }

    /// (receiver, royalty basis points) for a token. A token minted without a
    /// royalty reports `(collection address, 0)` — callers treat 0 bps as "no
    /// royalty" and must not pay the receiver in that case.
    pub fn token_royalty(e: &Env, token_id: u32) -> (Address, u32) {
        let (receiver, bps) = Base::royalty_info(e, token_id, BPS_PROBE_PRICE);
        (receiver, bps as u32)
    }
}

#[contractimpl(contracttrait)]
impl NonFungibleToken for CardCollection {
    type ContractType = Base;
}

#[contractimpl(contracttrait)]
impl NonFungibleBurnable for CardCollection {}

#[contractimpl(contracttrait)]
impl Ownable for CardCollection {}

#[cfg(test)]
mod test;
