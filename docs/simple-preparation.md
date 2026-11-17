# Simple preparation and stable refresh

The next preview simplifies the journey → family → checklist/bags flow, using
the Civic reference foundation in [mobile design](../apps/mobile/DESIGN.md).
It does not change the API, database, authorization rules or environment inputs.

## Preparation flow

- Journey: choose your family, open travel details or guides. Occasional actions
  such as invitations, shared content and archiving stay in the journey menu.
- Family: Checklist, Bags and Travelers. An empty roster points to adding people
  before choosing bag carriers.
- Checklist: Things to bring or Things to do. Items show "Have X of Y"; opening
  an item presents one quantity-update action. History, sharing and removal are
  in the item menu. Short forms keep optional details collapsed.
- Bags: Your bags or Items to pack. Each bag or item opens focused details.
  Coming-home reconciliation, room checks and history remain explicitly reachable.
- Journey details: dates, travel stage and stops. References and documents remain
  available; ordering/removal and stage changes move into contextual controls.

Quantity updates still require physical confirmation when they establish
availability. Availability never establishes packing, and packing still needs an
explicit location and physical confirmation. Sharing, partial updates, retry
identities and return-leg reconciliation keep their existing contracts.

## Refresh correction

The family/itinerary pages cleared their state before reads, replacing content
with skeletons. Automatic reads also drove manual button busy props. The open
page and reconnect cache checker could additionally start competing reads of
the same snapshot, producing "A newer refresh replaced this read" on Android.

Pages now retain current content during ordinary refresh. A focus-aware helper
shares each page's active read and suspends background reads while editing.
Packing reads capture their trip/family/leg identity so an old leg cannot publish
after a switch. Definitive denial clears private page data.

At the transport boundary, identical concurrent snapshot GETs share one live
request, with independent response bodies and cancellation per consumer. After
all consumers cancel, the underlying request is aborted. Settled responses are
not reused. Different credentials, URL/query, session or access generations do
not share work. All existing authorization, durable tombstone, generation and
latest-read checks remain. Writes are never shared, queued or replayed.

## Verification

Real HTTP/component tests first reproduced family content disappearing and the
background/foreground read collision. Both regressions now pass. The mobile
suite has 26 scenarios covering retained content, focused tabs, scope changes,
explicit refresh completion, transient failure, definitive denial, read sharing,
independent cancellation, late responses after revocation/account replacement,
cellular connectivity and native date/time conversion.

Android debug verification uses the hosted API and a restored session. Journey,
family, checklist, item details and quantity-form layouts were inspected. A
foreground/reconnect check under 2 seconds of emulator network delay retained
the visible family page without skeleton replacement or the competing-read
error. Test network conditions were restored. Existing user data is viewed only;
it is not changed to manufacture populated states. The existing family has no
travelers, so populated bag/carrier interactions are not claimed verified here.
The signed preview must be installed on a physical device for final acceptance.
Emulator observations and cloud build inspection do not establish that gate.
