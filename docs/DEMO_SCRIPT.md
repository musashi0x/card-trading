# TopDeck — 90-second demo script

**Track:** Consumer & Merchant Payment Flows
**Runtime:** 90s (a 60s cut is at the bottom)
**Thesis:** the payment flow *is* the product. Everything on screen serves one idea — nobody has to go first, and nobody has to trust us.

---

## The script

| Time | Voiceover | On screen |
|---|---|---|
| **0:00–0:08**<br>*Hook* | "In every peer-to-peer card trade, somebody has to go first. Ship the card before you're paid — or pay before it ships." | Two hands, one holding a card, one holding money. Both hesitate. Freeze frame. |
| **0:08–0:16**<br>*Problem* | "Marketplaces fix that by holding both sides — and charging ten to twenty percent for the privilege. TopDeck holds nothing." | Title card: **TopDeck — bid, win, collect.** Subtitle: *non-custodial settlement on Stellar.* |
| **0:16–0:30**<br>*List* | "Cards are real Stellar assets. Our merchant lists Nova Dragon for fifty USDC — and the card locks inside a Soroban contract. Not our wallet. The contract." | `/sell` → fill price → Freighter signs → listing goes live on `/browse`. Keep the signing prompt in frame; it proves the user holds the keys. |
| **0:30–0:42**<br>*Offer* | "A collector browses in, and offers forty. Their USDC locks in that same contract." | `/browse` → card detail → **Make offer: 40** → sign. Offer appears as *pending*. |
| **0:42–0:53**<br>**Proof** | "Here's the part that matters. On the block explorer, the contract is holding the card *and* the money. The seller doesn't have the cash. We don't have the cash. Neither side went first." | Cut to the explorer, contract balances. **Highlight both rows.** Hold this shot — it is the whole pitch. |
| **0:53–1:09**<br>**Settlement** | "The merchant accepts. One transaction: the card goes to the buyer, thirty-nine-point-two USDC goes to the seller, eighty cents to the platform — a transparent two percent. All of it, or none of it." | **Accept** → success → settlement hash. Cut to `/trades`, click the hash → explorer shows all three transfers in a single tx. |
| **1:09–1:19**<br>*Protection* | "And until a merchant accepts, the buyer can pull the offer back. Funds return instantly. They were never at risk." | Second offer → **Withdraw** → wallet balance ticks back up. |
| **1:19–1:30**<br>*Close* | "One contract also runs timed auctions, card-for-card swaps, and physical-card escrow — with passkey wallets, gasless transactions, and creator royalties enforced on-chain. Non-custodial payments that feel like checkout. That's TopDeck." | Fast montage: auction countdown, swap inbox, Face ID prompt. Land on logo + *Built on Stellar · Soroban · testnet*. |

**Word count:** ~215 — comfortable at a natural pace with room for the demo to breathe.

---

## Notes for the recording

**Non-negotiable shots.** The explorer at 0:42 and the single-transaction settlement at 0:53. Every other second is negotiable; these two are the submission.

**Say "the contract," never "we."** The whole claim is that no one custodies funds. Phrasing like "we hold the payment until…" undoes the pitch in four words.

**Pre-flight before you hit record:**
- Seed demo listings — `pnpm --filter @cardmkt/scripts run demo` — so `/browse` looks like a real market, not an empty grid.
- Have merchant + consumer wallets in two browser profiles side by side. Do **not** film a wallet switch; cut between profiles instead.
- Warm the mint. Listing right after a mint can throw `MISSING_TRUSTLINE` while Soroban RPC catches up a ledger or two behind Horizon — mint well before recording.
- Do not connect as `PLATFORM_ISSUER`; the API rejects it with `OWNER_IS_ISSUER`.
- Explorer tab pre-loaded on the contract address so 0:42 is a cut, not a page load.

**Numbers to keep exact.** 50 asking, 40 offer, 39.2 to seller, 0.8 to platform. Judges will check the arithmetic against the 2% fee you claim.

**Cover your dead air.** Signing and submission take a few seconds each. That's what the problem and protection beats are for — write the voiceover to run *over* the wait, and never cut to a spinner in silence.

---

## The 60-second cut

Drop the protection beat (1:09–1:19) and the montage; end on the settlement hash.

| Time | Beat |
|---|---|
| 0:00–0:06 | Hook — somebody has to go first |
| 0:06–0:18 | List — card locks in the contract |
| 0:18–0:28 | Offer — USDC locks in the contract |
| 0:28–0:38 | **Explorer — contract holds both** |
| 0:38–0:52 | **Accept — one atomic transaction, 2% fee** |
| 0:52–1:00 | Close — "non-custodial payments that feel like checkout" |

Cutting the withdraw beat costs you the consumer-protection story, so if judges weight *consumer* flows heavily, cut the montage instead and keep the withdraw.

---

## Alternate hooks

- **Cold open on the explorer.** Start at the contract holding both assets, no context: *"The card is here. The money is here. Neither the buyer nor the seller can touch either one — and that's the point."* Then rewind and show how they got there. Strongest option if you can land the rewind cleanly.
- **Merchant-first.** *"This merchant is about to sell a card to a stranger on the internet, and take payment without trusting them, without a middleman, and without paying fifteen percent."*
