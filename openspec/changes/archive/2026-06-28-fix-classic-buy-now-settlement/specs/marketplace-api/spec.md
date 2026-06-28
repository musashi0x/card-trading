## ADDED Requirements

### Requirement: Buy-now build rejects a closed listing
The transaction-building API SHALL reject a `buy_now` build request for a listing
that is not open, returning a machine-readable error before constructing the
settlement transaction, so a buyer never signs or broadcasts a transaction the
contract will reject. The on-chain `STATUS_OPEN` guard SHALL remain the
authoritative correctness gate; this pre-flight is an additional fast-fail.

#### Scenario: Build requested for an open listing
- **WHEN** a `buy_now` build is requested for a listing whose status is open
- **THEN** the API SHALL build and return the unsigned `buy_now` transaction as today

#### Scenario: Build requested for a sold or cancelled listing
- **WHEN** a `buy_now` build is requested for a listing whose status is `sold` or `cancelled`
- **THEN** the API SHALL return a `LISTING_CLOSED` pre-flight error
- **AND** SHALL NOT construct or return a settlement transaction

### Requirement: Escrow orders are not orphaned by abandoned signatures
The API SHALL NOT leave permanent `funded` order rows with no on-chain
counterpart when a buyer abandons or fails to sign a `purchase_escrow`
transaction. Either the order row SHALL be created only after the escrow
transaction confirms, or abandoned `funded` rows with no contract order id SHALL
be cleaned up after a bounded time window.

#### Scenario: Buyer abandons the escrow signature
- **WHEN** a buyer requests a `purchase_escrow` build but never submits a confirmed transaction
- **THEN** the system SHALL NOT retain a permanent `funded` order with `contractOrderId = null`
- **AND** the abandoned listing SHALL remain purchasable

#### Scenario: Confirmed escrow purchase persists an order
- **WHEN** a buyer completes a `purchase_escrow` transaction that confirms on-chain
- **THEN** the system SHALL persist the order with its `contractOrderId` and escrow transaction hash
- **AND** SHALL mark the listing as sold
