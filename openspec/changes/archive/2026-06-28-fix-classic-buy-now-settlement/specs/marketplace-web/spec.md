## MODIFIED Requirements

### Requirement: Accept an offer and buy now
The web app SHALL let a seller accept an offer and let a buyer buy at the asking price, each settling the trade atomically. Buy-now SHALL submit a real on-chain settlement for every wallet type — classic and passkey — and SHALL NOT present a purchase as complete unless the settlement transaction has confirmed.

#### Scenario: Seller accepts an offer
- **WHEN** a seller accepts an open offer and confirms
- **THEN** the app SHALL have them sign the `accept_offer` transaction
- **AND** on success SHALL show the trade as settled

#### Scenario: Buyer buys now
- **WHEN** a buyer chooses buy-now on a listing and confirms
- **THEN** the app SHALL have them sign the `buy_now` transaction
- **AND** on success SHALL show the trade as settled and the card transferred

#### Scenario: Classic wallet buys now with USDC
- **WHEN** a buyer on a classic wallet with USDC as the source asset confirms buy-now
- **THEN** the app SHALL build, sign, and submit the `buy_now` settlement transaction via the buy-now API
- **AND** SHALL show success only after the settlement transaction confirms
- **AND** SHALL NOT mark the card as owned without a confirmed settlement transaction

#### Scenario: Buy-now reports a failed settlement
- **WHEN** the `buy_now` settlement transaction fails or is rejected
- **THEN** the app SHALL surface the failure to the buyer
- **AND** SHALL NOT show the card as owned

### Requirement: Pay for a card with any held asset

The web app SHALL let a buyer choose a source asset other than USDC when buying a
card or making an offer, display a live conversion quote before they commit, and
sequence the optional conversion ahead of the unchanged settlement step. The
source-asset picker SHALL default to USDC so existing behavior is preserved. When
the conversion has committed but the subsequent settlement does not complete, the
app SHALL communicate the buyer's residual USDC balance and a way to retry rather
than presenting the purchase as successful.

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
- **AND** SHALL show success only after the settlement step confirms

#### Scenario: Settlement fails after the conversion committed

- **WHEN** the path-payment conversion has confirmed but the subsequent `buy_now`
  settlement fails (for example the listing was sold first, or a transient error)
- **THEN** the app SHALL NOT present the purchase as successful
- **AND** SHALL inform the buyer they now hold the converted USDC
- **AND** SHALL offer to retry the settlement or apply the held USDC to another
  card, distinguishing a permanently closed listing from a retryable error

#### Scenario: USDC trustline prompt

- **WHEN** the API reports the buyer lacks a USDC trustline
- **THEN** the app SHALL prompt the buyer to sign a `change_trust` transaction
  before the conversion

#### Scenario: Buyer already holds enough USDC

- **WHEN** the buyer's USDC balance already covers the amount
- **THEN** the app SHALL skip the conversion step and go straight to settlement,
  unchanged from today's flow
