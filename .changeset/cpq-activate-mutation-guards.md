---
'@dainamite/cpq': patch
---

`POST /api/cpq/orders/:orderId/activate` now runs the framework mutation guards before activating (resource kind `cpq.order`, operation `update`, payload `{ action: 'activate', orderId }`). A blocking guard's status and body are returned as-is (typically 422). After-success callbacks run once the activation commits. The route now exports `openApi`. With no guard registered, behaviour is unchanged.
