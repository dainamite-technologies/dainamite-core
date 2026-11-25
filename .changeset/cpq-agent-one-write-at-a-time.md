---
'@dainamite/cpq': patch
---

CPQ Quoting and Catalog assistants propose one write at a time. Two approval cards for the same quote shared one record version, so after the first was confirmed the second was refused as stale (412) and the chat showed the card again with no error.

They also re-read the saved quote when the operator continues after a confirmed card. The chat history holds only message text, so the agent used to call its own earlier prices unverified and try to create the quote again.
