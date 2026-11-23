---
'@dainamite/cpq': minor
---

Component-only offerings (#133). Offerings get `isSellable` (TMF620): when false, the offering can only be quoted as a bundle component. Adding it as a top-level quote line returns 422 `V-QLINE-1`, and conversion to an order re-checks it. Specifications get `defaultOfferingSellable`, which pre-fills the flag on new offerings. The quote "Add Offering" picker, the wizard offering step and `cpq.list_offerings` can filter on it. Bundle default expansion now skips child offerings that are not lifecycle-active. Run `yarn mercato db migrate` after upgrading.
