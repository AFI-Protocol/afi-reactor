# Conformance proof graphs (vendored byte-copies)

Provenance: the 8 factory conformance fixtures in this directory are
byte-identical copies of `fixtures/conformance/*.json` from
**afi-factory@9f88ede** (the SLOT-FCP-FACTORY gate commit), vendored here by
SLOT-FCP-CLEANUP (D-FCP-9) when the `afi-factory` file: dependency was cut
from afi-reactor. Authoring stays in afi-factory; the Reactor consumes these
committed copies only as executor conformance-proof inputs
(`test/pipeline/support/testHarness.ts` / `test/pipeline/graphProofs.test.ts`).

Do not hand-edit. If the factory conformance suite changes under governance,
re-vendor byte-copies from the approved afi-factory commit and update this
provenance note.
