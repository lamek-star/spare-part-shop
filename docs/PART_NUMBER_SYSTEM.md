# Part number system

Part has an internal SKU and a separate PartNumber relationship. Every number retains its original display value and an opaque immutable ID. Search normalization uppercases and removes whitespace and hyphens; other punctuation remains significant. This deliberately conservative rule can be replaced with provider-specific normalization policies.

All 15 requested types are represented by the NumberType union. Samples include SKU, OEM, MPN, supplier, aftermarket, cross reference, interchange, previous and illustrative barcode identifiers. No identifier or vehicle fitment is claimed to be verified. The example 04465-0K290 is retained solely as the requested demonstration search value; its association with a product or vehicle is unverified.

Each number has brand, optional supplier, source, market, active state, primary flag, notes and verification metadata. OEM numbers are not globally unique. Adding a primary number clears the primary flag for that part and type only. Number IDs are not derived from display strings.

Cross References searches a number, identifies the related part and displays its other numbers and provenance. The detail view shows previous-to-current supersession. The adapter walks replacement chains and rejects circular relationships atomically. Shared attachment to a part is a demo relationship, not proof of engineering interchangeability.
