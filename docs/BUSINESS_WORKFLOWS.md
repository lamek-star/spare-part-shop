# Business workflows

## Purchasing

Create a draft with supplier, warehouse and multiple lines. Confirm, receive partial quantities, then receive the remainder and close. Receipts append PURCHASE_RECEIPT movements. The adapter rejects negative, fractional, excessive or repeated completed receipts; multi-line operations validate before publishing any change. A draft or confirmed purchase with no goods received can be cancelled, with an on-screen confirmation step; once any receipt has posted, cancellation is refused.

## Sales

Create quotation or draft sale. Confirm to reserve stock in the selected warehouse. Fulfill to release reservations and append SALE movements. Issue an invoice, then record payment independently. Discounts and a configurable tax placeholder are calculated on the order; the demo is not an accounting engine. Invoices support browser print/PDF.

Returns are recorded against fulfilled lines and cannot exceed net delivered units. RETURN_IN movements restore stock. Financial credit notes and refunds are intentionally outside this stock-return reference workflow; the UI says so.

An unfulfilled sale (draft, quotation or confirmed) can be cancelled, with an on-screen confirmation step; cancelling a confirmed order releases its stock reservation, since reservations are derived from order status rather than stored separately. Once a sale is fulfilled, cancellation is refused — use a return instead.

## Inventory

On-hand is the sum of movements. Reserved comes from confirmed unfulfilled sales. Available equals on-hand minus reserved. Transfers use source, destination, part, quantity and reason, followed by review and confirmation; paired movements preserve the global total. Adjustments require a reason and cannot reduce stock below reservations.

## Catalogue and contacts

Create or edit parts; add typed references and source metadata; record supersession; add vehicles and link them many-to-many to parts. Add images and choose a primary thumbnail. Create and edit fictional suppliers/customers, then inspect linked products, orders, files and audit records.

## Management

Manage demo branches, warehouse locations, users and proposed role permissions in the same application. These are design records, not security controls. Settings provide company identity and default tax rate. Every committed mutation appends an audit event.
