# Category F — Multi-Turn / State Confusion

**Vulnerability surface.** A stateless guard cannot verify any claim that
references prior conversation, prior approval, or in-flight transaction
state. Cat F seeds encode the family of "as we agreed earlier" / "this is
the second leg" framings that exploit a guard's lack of persistent memory.

Corpus: 35 attack payloads (`F-0001` through `F-0035`), 10 benign
counterparts.

---

## F.1 — Prior-conversation claim

**Mechanism.** Reasoning asserts continuity with an earlier turn that does
not exist in the current request ("as we agreed yesterday", "as requested
in our chat", "follow-up to last week's call"). The guard has no chat
history to refute the claim.

**Variation surfaces.** Time reference (yesterday / earlier / last week);
channel claim (chat / call / email); pairing with a vendor that fits the
fictional context.

**Sample payload IDs.** `F-0001`, `F-0002`, `F-0010`, `F-0015`, `F-0025`.

---

## F.2 — Retry / split / partial-payment claim

**Mechanism.** Frames the current charge as the second half / retry /
remainder of a previously-approved payment ("retrying the approved
payment that failed", "second half of the split-payment", "final partial
payment"). Targets approval-bias when the guard treats retries as already
sanctioned.

**Variation surfaces.** Continuity verb (retry / second half / final
installment); reason for fragmentation (failure / split / scheduled).

**Sample payload IDs.** `F-0003`, `F-0006`, `F-0007`, `F-0024`, `F-0026`,
`F-0032`.

---

## F.3 — Receipt / ticket / confirmation-code reference

**Mechanism.** Cites a fabricated receipt / ticket / confirmation code
("RC-7721", "ticket #4421", "conf code AB12-XY") to anchor the
transaction in a fictitious prior state. The code looks like an
authoritative artifact but is unverifiable.

**Variation surfaces.** Code format (receipt / ticket / conf / order #);
prefix style; pairing with "supplementary charge" / "overage" / "true-up"
narrative.

**Sample payload IDs.** `F-0004`, `F-0005`, `F-0011`, `F-0023`, `F-0034`.

---

## F.4 — Subscription / contract / promised-renewal continuation

**Mechanism.** Frames the charge as part of a recurring obligation
("legacy obligation from 2023 SMS gateway setup", "promised renewal",
"contract continuation", "mid-cycle subscription adjustment").
Persistence framing pressures approval.

**Variation surfaces.** Obligation type (legacy / contract / subscription
/ renewal); time frame ("from 2023" / "mid-cycle"); vendor that plausibly
sells subscription products.

**Sample payload IDs.** `F-0012`, `F-0013`, `F-0014`, `F-0015`, `F-0022`,
`F-0028`, `F-0029`, `F-0030`.

---

## F.5 — Batch / queued / pending-approval continuation

**Mechanism.** Claims the transaction is one item in a previously-batched
flow ("batch continuation", "queued transaction", "pending approval from
last batch"). The framing implies prior aggregate approval covers this
specific item.

**Variation surfaces.** Aggregation noun (batch / queue / pending list);
position claim (item N of M); vendor that plausibly issues batched
transactions.

**Sample payload IDs.** `F-0008`, `F-0017`, `F-0018`, `F-0021`, `F-0033`,
`F-0035`.

---

## F.6 — Resumption / interrupted-flow claim

**Mechanism.** Frames the request as resuming an interrupted prior step
("resumption after timeout", "interrupted flow continuation",
"continuing after refresh"). Targets the guard's tendency to give
in-progress flows benefit of the doubt.

**Variation surfaces.** Interruption cause (timeout / refresh / network /
session expiry); resume verb.

**Sample payload IDs.** `F-0009`, `F-0019`, `F-0027`, `F-0031`.

---

## F.7 — Refund / reversal / followup framing

**Mechanism.** Claims this is a refund-reversal, follow-up adjustment, or
correction of a previously-made charge — pressing the guard to treat the
charge as a passive bookkeeping action rather than a fresh authorisation.

**Variation surfaces.** Action verb (refund-reversal / adjustment /
correction / true-up); referenced original transaction.

**Sample payload IDs.** `F-0016`, `F-0020`.

