# IntraForge integration

| UI concept | Future platform concept |
|---|---|
| Part, PartNumber, Vehicle, Warehouse, Contact | AppModel |
| Name, cost, currency, source metadata | AppField |
| Part to numbers | AppRelationship, one-to-many |
| Part to vehicles | AppRelationship, many-to-many |
| Order to lines | Parent/child relationship |
| Stock movement | AppModel with transactional workflow |
| Receive, fulfill, transfer | Authorized platform command/workflow |
| Documents and images | File metadata and platform storage URLs |
| Branch | AppModel or platform organization scope, contract-dependent |
| Current user and permissions | Platform identity and permission provider |
| Installed application scope | AppInstance |
| Audit events | Platform audit contract |

src/integrations/intraforge is the only future integration boundary. Contract must specify AppInstance context, model/field identifiers, queries, pagination, error mapping, concurrency tokens, idempotency and file access. No API paths or PostgreSQL table names are assumed. Server must enforce authorization and atomic stock operations. Demo persona visibility is not authorization.
