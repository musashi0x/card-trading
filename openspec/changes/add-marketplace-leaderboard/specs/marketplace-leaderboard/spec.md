# Capability: marketplace-leaderboard (ADDED)

## Purpose

Provides ranked competitive boards derived from real on-chain activity. Three
boards are supported: collectors (ranked by season collection value), sellers
(ranked by 90-day gross sales volume, with optional rating), and traders (ranked
by all-time realized profit and ROI). Every response includes the requesting
user's own rank and metric values alongside the top-N rows.

---

## ADDED Requirements

### Requirement: Collectors board ranks users by season collection value

The collectors board SHALL rank every user who has completed at least one buy-side
trade in the current calendar year by the total value of cards they currently
hold, where value is approximated as the sum of last settled purchase prices for
cards not subsequently resold. Secondary stats SHALL include the count of cards
held and the user's win rate (buy-side trades won ÷ total buy-side offers made).

#### Scenario: Ranked collectors list

- **WHEN** a client requests `board=collectors`
- **THEN** the API SHALL return rows ranked descending by `collectionValue`
- **AND** each row SHALL include `rank`, `stellarAddress`, `collectionValue`, `cardsHeld`, and `winRate`
- **AND** only users with at least one buy-side trade in the current calendar year SHALL appear

#### Scenario: Collector with no current-year trades excluded

- **WHEN** a user has only trades from a prior calendar year
- **THEN** that user SHALL NOT appear in the collectors board
- **AND** their own-standing entry SHALL show `rank: null` and `collectionValue: 0`

#### Scenario: Collector sells all held cards

- **WHEN** a user's sell-side trade count equals their buy-side trade count for a given card
- **THEN** that card SHALL contribute zero value to their `collectionValue`
- **AND** `cardsHeld` SHALL reflect only net-positive holdings

#### Scenario: Tied collection values

- **WHEN** two users have identical `collectionValue`
- **THEN** the API SHALL break the tie by number of `cardsHeld` descending
- **AND** if still tied, by `stellarAddress` ascending (deterministic ordering)

---

### Requirement: Sellers board ranks users by 90-day gross sales volume

The sellers board SHALL rank every user who has completed at least one sell-side
trade in the trailing 90 days by the sum of `priceUsdc` for those trades. If the
`reviews` table is present, each row SHALL include the seller's average rating
(`avgRating`); otherwise `avgRating` SHALL be `null` and the response SHALL
include `"ratingAvailable": false`. Secondary stats SHALL include the count of
sales in the window.

#### Scenario: Ranked sellers list with rating available

- **WHEN** a client requests `board=sellers` and the `reviews` table exists
- **THEN** the API SHALL return rows ranked descending by `salesVolume90d`
- **AND** each row SHALL include `rank`, `stellarAddress`, `salesVolume90d`, `salesCount`, and `avgRating`
- **AND** the response SHALL include `"ratingAvailable": true`

#### Scenario: Ranked sellers list without reviews table

- **WHEN** a client requests `board=sellers` and the `reviews` table does not exist
- **THEN** the API SHALL return rows with `avgRating: null` on every row
- **AND** the response SHALL include `"ratingAvailable": false`
- **AND** the board SHALL otherwise be fully populated and ranked by `salesVolume90d`

#### Scenario: Seller outside the 90-day window

- **WHEN** a user's only sell-side trades settled more than 90 days ago
- **THEN** that user SHALL NOT appear in the sellers board
- **AND** their own-standing entry SHALL show `rank: null` and `salesVolume90d: "0"`

#### Scenario: Seller rating from partial reviews

- **WHEN** a seller has 10 settled trades but only 3 counterparty reviews
- **THEN** `avgRating` SHALL be the average of those 3 review ratings
- **AND** `salesCount` SHALL reflect all 10 settled trades in the window

---

### Requirement: Traders board ranks users by all-time realized profit

The traders board SHALL rank every user who has at least one sell-side trade
(all time) by realized profit, defined as `SUM(priceUsdc − feeUsdc −
royaltyUsdc)` for sell-side trades minus `SUM(priceUsdc)` for buy-side trades.
ROI SHALL be expressed as a percentage (`profit ÷ totalBuyCost × 100`), rounded
to one decimal place and formatted with a leading `+` or `−`. Secondary stats
SHALL include the number of completed buy→sell card pairs ("flips").

#### Scenario: Ranked traders list

- **WHEN** a client requests `board=traders`
- **THEN** the API SHALL return rows ranked descending by `realizedProfit`
- **AND** each row SHALL include `rank`, `stellarAddress`, `realizedProfit`, `roi`, and `flipCount`
- **AND** only users with at least one sell-side trade SHALL appear

#### Scenario: Trader with net loss

- **WHEN** a user's total buy cost exceeds their total sell proceeds
- **THEN** `realizedProfit` SHALL be a negative value
- **AND** `roi` SHALL be formatted with a leading `−` (e.g. `"−12.3%"`)
- **AND** the user SHALL appear in the board ranked below profitable traders

#### Scenario: Trader with zero buy history

- **WHEN** a user has sell-side trades but no recorded buy-side trades (e.g. received cards via minting)
- **THEN** `realizedProfit` SHALL equal `SUM(sellerNetUsdc)` and `roi` SHALL be `null`
- **AND** `flipCount` SHALL be `0`

#### Scenario: All-time window includes all settled trades

- **WHEN** a user has trades spanning multiple calendar years
- **THEN** ALL of those trades SHALL contribute to `realizedProfit` and `flipCount`
- **AND** no date filter SHALL be applied to the traders board

---

### Requirement: Own standing is returned with every board response

Every leaderboard response SHALL include an `ownStanding` object for the
requesting account. When `account` is omitted from the request, `ownStanding`
SHALL be `null`. When the account has no activity on the requested board,
`ownStanding.rank` SHALL be `null` and metric fields SHALL be `0` or `"0"`.

#### Scenario: Authenticated user in top-N list

- **WHEN** the requesting `account` appears in the top-N rows
- **THEN** `ownStanding` SHALL mirror the matching row's values
- **AND** the row SHALL also appear normally in the ranked `rows` array

#### Scenario: Authenticated user outside the top-N list

- **WHEN** the requesting `account` is ranked below the returned `limit`
- **THEN** `ownStanding` SHALL include the user's true `rank` and metric values
- **AND** the user SHALL NOT appear in the `rows` array

#### Scenario: Account with no board activity

- **WHEN** the requesting `account` has no trades qualifying for the requested board
- **THEN** `ownStanding.rank` SHALL be `null`
- **AND** all metric fields in `ownStanding` SHALL be `"0"` or `0`

#### Scenario: Request without account parameter

- **WHEN** a client omits the `account` query parameter
- **THEN** `ownStanding` SHALL be `null`
- **AND** the `rows` array SHALL be returned normally
