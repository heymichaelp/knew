# What's new in Haunts

Haunts is adding three things. Change the app you built to meet them, and keep everything else
working.

- **A fifth kind of statement**, `PRICE`: how much a place costs. Keep the name exactly.
- **The visit view gains a last step**: **How much it costs**, after what to order.
- **A second planning view, for deciding where to go tonight.** `nextTonight(userId, placeId)`
  answers like `nextToLearn`, naming the first of these that applies:
  1. **When it is open**, when that isn't known, or when no hours have been heard for 30 days or
     more; then `recheck` lists the hours statements, as before.
  2. **What it is like to be there**, when that isn't known.
  3. **How much it costs**, when that isn't known.

  Tonight doesn't need what kind of place it is or what to order. It returns `null` when nothing
  is left worth finding out, or for a place the user never added.

The reader can now return statements whose topic is `PRICE`.
