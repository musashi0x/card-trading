## MODIFIED Requirements

### Requirement: Convert any held asset to the exact settlement USDC
The system SHALL let a buyer fund a purchase with a source asset they hold by converting it into the exact USDC amount a settlement requires, using a Stellar `PathPaymentStrictReceive` whose destination is the buyer's own account. The settlement contract SHALL remain USDC-only; conversion SHALL occur in a separate transaction submitted before settlement. The system SHALL confirm the target listing is still open immediately before building the conversion so a buyer does not spend on an already-closed listing.

#### Scenario: Buyer holding only XLM buys a card
- **WHEN** a buyer who holds XLM but insufficient USDC chooses XLM as the source asset for a `buy_now` priced in USDC
- **THEN** the system SHALL build a path payment delivering exactly the required USDC to the buyer, sourced from XLM
- **AND** after that payment confirms, the buyer SHALL complete the unchanged `buy_now` settlement, leaving the seller paid in USDC

#### Scenario: Settlement contract is not modified
- **WHEN** any pay-with-any-asset purchase settles
- **THEN** the contract SHALL receive and distribute USDC exactly as for a native-USDC purchase, with no contract-side asset conversion

#### Scenario: Listing closed before conversion
- **WHEN** the target listing is no longer open at the moment the buyer confirms, before the conversion is built
- **THEN** the system SHALL abort with a machine-readable closed-listing error
- **AND** SHALL NOT build or submit the conversion, so the buyer spends nothing

## ADDED Requirements

### Requirement: Recover gracefully when settlement fails after conversion
The system SHALL handle the non-atomic seam between conversion and settlement, since these are separate transactions. When the conversion has irreversibly committed but the settlement does not complete, the system SHALL NOT report success, SHALL preserve and report the buyer's converted USDC, and SHALL distinguish a permanently closed listing from a retryable failure.

#### Scenario: Listing taken between conversion and settlement
- **WHEN** the path-payment conversion has confirmed and the buyer's `buy_now` then fails because the listing was already settled (`NotOpen`)
- **THEN** the system SHALL report that the listing is no longer available
- **AND** SHALL report that the buyer holds the converted USDC
- **AND** SHALL offer to apply that USDC to another card rather than retrying the same closed listing

#### Scenario: Transient settlement failure after conversion
- **WHEN** the conversion has confirmed but `buy_now` fails for a transient reason (for example a network or RPC error) on a listing that is still open
- **THEN** the system SHALL report the failure as retryable
- **AND** SHALL allow the buyer to retry the `buy_now` settlement without converting again, since the required USDC is already held

#### Scenario: Conversion quote bounds the residual
- **WHEN** the system builds the conversion for a purchase
- **THEN** the delivered USDC SHALL equal the settlement amount so that, on a post-conversion failure, the buyer's residual USDC is bounded to the settlement price plus the slippage cap and is exactly reusable for a subsequent purchase
