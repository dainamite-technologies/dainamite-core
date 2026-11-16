---
'@dainamite/cpq': minor
---

`POST /api/cpq/orders/:orderId/activate` now runs the framework mutation guards before activating (resource kind `cpq.order`, operation `update`, payload `{ action: 'activate', orderId }`). A blocking guard's status and body are returned as-is (typically 422). After-success callbacks run once the activation commits. The route now exports `openApi`. `POST /api/cpq/orders/:orderId/status` runs the same guards: a transition to `active` carries `{ action: 'activate', orderId, targetStatus }`, so it cannot bypass an activation rule, and other transitions carry `action: 'transition'`. This is a new extension hook (minor). With no guard registered, behaviour is unchanged.
