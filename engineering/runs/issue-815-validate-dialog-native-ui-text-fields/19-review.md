# Issue 815 Architecture Review

Locked architecture: one private `DialogDisplayText` schema rejects empty strings and ASCII control bytes, and every platform-visible Dialog text field uses it before host transport.

Review findings:

| Check         | Verdict | Notes                                                                                 |
| ------------- | ------- | ------------------------------------------------------------------------------------- |
| Correctness   | Pass    | The schema covers file dialog titles, message title/message/detail, and confirm text. |
| Minimality    | Pass    | No new validation helper module; policy stays inside the existing Dialog contract.    |
| Safety        | Pass    | Invalid text fails as `InvalidArgument` and does not reach the bridge exchange.       |
| Compatibility | Pass    | Existing valid request shapes stay unchanged; omitted optional fields stay valid.     |

Rejected expansion: allowing multiline `detail`. The issue asks for one native-dialog display-string schema and no docs currently promise multiline detail semantics, so control bytes stay rejected uniformly.
