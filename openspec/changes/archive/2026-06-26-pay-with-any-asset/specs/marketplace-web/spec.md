## ADDED Requirements

### Requirement: Pay for a card with any held asset

The web app SHALL let a buyer choose a source asset other than USDC when buying a
card or making an offer, display a live conversion quote before they commit, and
sequence the optional conversion ahead of the unchanged settlement step. The
source-asset picker SHALL default to USDC so existing behavior is preserved.

#### Scenario: Buyer selects a non-USDC asset and sees a quote

- **WHEN** a buyer opens the buy or offer modal and selects a source asset such
  as XLM
- **THEN** the app SHALL show a live quote ("You pay ~X XLM → seller receives Y
  USDC") including the slippage cap before the buyer confirms

#### Scenario: Buyer converts then settles

- **WHEN** the buyer confirms a purchase funded by a non-USDC asset
- **THEN** the app SHALL prompt the buyer to sign the path-payment conversion
  first, and on its confirmation proceed to the existing `buy_now` /
  `accept_offer` settlement step

#### Scenario: USDC trustline prompt

- **WHEN** the API reports the buyer lacks a USDC trustline
- **THEN** the app SHALL prompt the buyer to sign a `change_trust` transaction
  before the conversion

#### Scenario: Buyer already holds enough USDC

- **WHEN** the buyer's USDC balance already covers the amount
- **THEN** the app SHALL skip the conversion step and go straight to settlement,
  unchanged from today's flow
