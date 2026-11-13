# NMT Travel

Status: Approved by the user. The product design interview is complete.

## Product idea

NMT Travel is an Android app built with React Native that helps families prepare for Hajj or Umrah, coordinate during the journey, and bring their belongings home. It combines shared checklists, purchase tracking, bag packing, travel details, and guide documents in one place.

The first production release will accept public sign-ups, with the creator's upcoming family Umrah trip as the first real use case. The family should be able to answer four questions at any point: what remains to arrange, who is responsible, where an item is packed, and what needs attention before the next departure.

The product will focus on Hajj and Umrah for now. General travel support will be considered after the real Umrah trip provides evidence about what works. Keep the underlying concepts reusable, but do not build a generic trip builder, iOS app, or travel marketplace in this release.

## Decisions confirmed in the design interview

- Public sign-ups are required at launch. See [ADR-0001](adr/0001-public-signups-at-launch.md).
- A trip has one or more family groups. Traveler profiles are separate from account-backed trip membership so adults can manage children or elders without separate logins. See [ADR-0002](adr/0002-separate-travelers-from-trip-members.md) and the [glossary](../GLOSSARY.md).
- Development uses Expo development builds, and the first public release APK includes EAS Update. Eligible improvements can ship during the trip, and there is no fixed pre-departure feature freeze. See [ADR-0003](adr/0003-ota-support-in-first-android-build.md).
- Trips stay private, joining requires an approved invitation, and family checklists, bags, and guides are family-only by default unless explicitly shared with the trip. See [ADR-0004](adr/0004-private-trips-and-family-content.md).
- Launch sign-in supports Google and email one-time codes. Sign-up collects first name, last name, username, and email through either route.
- Initial public distribution uses APK downloads rather than Google Play. See [ADR-0005](adr/0005-distribute-public-apks-initially.md).
- All described active launch features remain requested in the first usable APK, including uploads, in-app PDF and image guides, bag photos, attachments, and optional user-requested downloads. The storage restriction applies to Neon services, not to removing app features.
- Shared trip data is editable only while online. Offline use is cached viewing and downloaded guides, with no offline edit queue. See [ADR-0006](adr/0006-online-edits-and-offline-viewing.md).
- A trip organizer needs explicit permission from another family to read or edit that family's private content. Organizer powers over the trip do not bypass family privacy. See [ADR-0004](adr/0004-private-trips-and-family-content.md).
- Usernames are globally unique and case-insensitive, names are used for display, and emails remain private. Both sign-in methods for the same verified email resolve to one account and its existing memberships. See [ADR-0007](adr/0007-member-handles-and-linked-sign-in.md).
- Use Neon PostgreSQL for application data and Clerk for hosted Google and email-code authentication. See [ADR-0008](adr/0008-neon-database-and-hosted-auth.md).
- Each family has at least one family coordinator controlling membership, access grants, and sharing. The trip organizer controls trip details and trip invitations. See [ADR-0004](adr/0004-private-trips-and-family-content.md).
- A trip-shared bag contains only explicitly trip-shared items. A family-only item needs sharing permission before it can be packed into that bag.
- Competing online edits use server acceptance order and update only changed fields. The latest valid accepted change to a field wins; access and quantity constraints still apply. See [ADR-0009](adr/0009-latest-edit-wins.md).
- Downloaded OTA updates apply on the next app start or through an optional restart action, without interrupting packing or guide reading.
- The existing source repository is now public following the user's explicit request, and can host public APK release assets. See [ADR-0005](adr/0005-distribute-public-apks-initially.md).
- Limit Neon to PostgreSQL. Neon storage services and Neon Functions are excluded; the API uses a Next.js boilerplate on Vercel. See [ADR-0008](adr/0008-neon-database-and-hosted-auth.md) and [ADR-0010](adr/0010-nextjs-api-on-vercel.md).
- Every trip member can read trip-shared content, members with edit access can update it, and only the owning family's coordinators can change its sharing permissions.
- Invitations target a verified email or existing username. Trip admission requires organizer approval, and family access requires its coordinator's approval.
- The selected production application domain for Clerk is `travel.nmtsolutions.in`. DNS and production service configuration are setup work, not completed resources.
- The app name is `NMT Travel`, and its stable Android package ID is `in.nmtsolutions.travel`, matching `travel.nmtsolutions.in`. See [ADR-0011](adr/0011-stable-android-app-identity.md).
- Files use private Cloudflare R2 storage, with authorization through the Next.js API on Vercel and metadata in Neon. See [ADR-0012](adr/0012-private-file-storage.md).
- Guide documents, PDFs, and images open inside the app by default. Persistent offline copies and downloads to device files are optional user actions; viewing never automatically saves a file to Android Downloads.

The first usable APK is requested for November 14, 2026, interpreting "tomorrow" relative to the November 13 conversation date. November 20, 2026 remains the supplied travel-planning date. Traveler and active-editor counts have not been provided. The requested delivery date is a target; feasibility has not yet been validated by an implementation.

The feature list below is the approved launch scope, including the final review revisions. The architecture uses Expo Android, Next.js on Vercel, Neon PostgreSQL, Clerk, and private Cloudflare R2. Items explicitly described as future work or outside scope remain separate from active launch features.

Remaining implementation prerequisites are service/project access, production DNS and OAuth configuration, Android signing and EAS setup, and physical-device validation. Traveler/editor counts and the actual test devices have not been supplied and can be collected for test coverage. These are setup and delivery inputs, not unresolved product decisions.

## Initial operating defaults

Use private R2 for uploaded PDFs, images, bag photos, and attachments, with file metadata and access rules in Neon. The Next.js API authorizes each operation after checking Clerk identity and current family/trip permissions. The viewing and optional download behavior is recorded in [ADR-0012](adr/0012-private-file-storage.md).

Retain these initial implementation defaults from the reviewed proposal:

- Usernames contain 4 to 30 letters, numbers, or underscores, are stored in lowercase, and remain globally unique. Username renaming is outside the initial account settings.
- Display names and usernames are visible to members of shared trips, with no global profile directory. Email addresses remain private to the account owner.
- Targeted invitations expire after seven days, can be revoked, and accept only the intended account. Acceptance consumes the invitation rather than creating a reusable access pass.
- Uploaded files support PDF, JPEG, PNG, and WebP, with a 20 MB limit per file. Other formats are outside the initial upload picker.
- Family and trip administration must retain a responsible coordinator or organizer. Transferring responsibility or explicitly deleting the owned group is required before its last administrator leaves or deletes their account.

These are initial limits and account settings within the agreed feature set.

## Who it helps

- A trip organizer who coordinates dates, bookings, documents, and shared preparation.
- Family members who buy items, receive deliveries, pack bags, and share responsibility.
- Travelers who need a clear personal list and access to the family's travel guides.
- Children and elders whose preparation another family member manages. A traveler profile should work without its own account or phone.
- Several families traveling together who need family lists and a small set of group responsibilities.

The app should remain usable when one person manages everything. Other relatives can join the same trip later without rebuilding its lists.

## Launch feature scope

The user requested the complete active feature set at launch. File-related features stay included, while Neon is used only for PostgreSQL. Public sign-ups, family access boundaries, Expo with EAS Update, Clerk sign-in, sign-up fields, initial APK distribution, and online-only edits are confirmed.

| Area | First production release | After the Umrah trip |
| --- | --- | --- |
| Trip purpose | Umrah and Hajj, with the first real-world validation on Umrah | Evaluate general travel |
| Platform | React Native for Android with Expo development builds | Consider iOS only when requested |
| App access | Public sign-ups, private trips, approved invitations | Expand based on use by independent travel groups |
| Sign-in and profile | Google and email codes; first name, last name, username, email | Refine based on real onboarding use |
| API and database | Next.js on Vercel, Neon PostgreSQL, Clerk authentication | Keep the same access boundaries as the app grows |
| Distribution | Public APK downloads; existing source repository is public | Reconsider Google Play separately |
| Updates | EAS Update configured in the first distributed Android build | Continue shipping compatible improvements during the trip |
| Collaboration | Private trips, family coordinators, member invitations, assignments, viewer access | Consider larger tour groups and travel agencies |
| Preparation | Editable templates, custom items, quantities, purchase progress, tasks | Add templates based on actual use |
| Packing | Named bags and independent outbound and return checklists | Consider additional journey legs if needed |
| Guides | PDFs, images, notes, and links viewed in the app; optional offline saving and device downloads | Consider audio, video, and richer authoring |
| Connectivity | Online edits, shared updates, cached offline viewing, downloaded guides | Revisit offline editing separately if useful |
| Experience | Light and dark themes, accessible controls, purposeful animations | Expand visual options only when useful |

Hajj-specific categories and editable journey milestones belong in the product. A complete Hajj ritual companion is outside the first release.

## Trip and family structure

A trip contains its travelers, family groups, dates, destinations, checklists, bags, travel details, and guide library. Each traveler belongs to a family for this trip. An item can serve one traveler, a family, or the whole trip.

Keep the traveler who needs an item separate from the member responsible for arranging it. A parent may buy clothing for a child, and one adult may carry a shared charger for several people.

Use three membership roles:

| Role | Responsibilities |
| --- | --- |
| Organizer | Manage trip details, invitations, family groups, shared templates, and membership |
| Member | Add and update permitted items, accept assignments, manage bags, and contribute permitted guides |
| Viewer | Read the trip information and documents shared with them, without changing preparation or packing |

Family coordination is a separate responsibility. Each family must have at least one family coordinator who manages that family's membership, access grants, and sharing. A member can be both a trip organizer and their own family's coordinator; organizing the trip does not make them coordinator of every family.

A traveler profile without an account is not a membership role. A responsible member updates that traveler's preparation.

Family checklists, bags, and guides are family-only by default. Content must be explicitly shared before other families in the trip can see it. Trip membership alone does not grant another family's content, and public sign-up grants no trip access. A trip organizer also needs explicit permission from another family before reading or editing its private content. Family coordinators control those grants and sharing decisions. Every trip member can read trip-shared content, members with edit access can update it, and viewers remain read-only. Only the owning family's coordinators can change its sharing permissions.

## Sign-up and member profiles

Support Google sign-in and an email one-time-code route. Both sign-up routes collect first name, last name, username, and email. Prefill fields from Google when available and collect any missing profile details before onboarding finishes.

The member profile is separate from the travel roster. Adding a child or elder as a traveler does not create a login for them.

Usernames are globally unique and case-insensitive. Use first and last names for display and keep email addresses private to their owner. Google and email-code sign-in for the same verified email must use the same account and retain its memberships, without requiring a separate account-linking step.

Initial username validation and profile visibility are listed in the operating defaults above. Matching a username or an unverified email is not sufficient to merge accounts.

## Journey lifecycle

The active trip phase determines what appears first on the home screen. The organizer changes phases manually so the app does not mistake a flight time or a time-zone change for an actual departure.

| Phase | Main focus |
| --- | --- |
| Planning | Add travelers, dates, templates, travel details, and guides |
| Preparing at home | Arrange missing items, receive orders, complete tasks, and pack outbound bags |
| Traveling to the destination | Check departure essentials, open travel details, and confirm bags on arrival |
| During the stay | Find belongings, record destination purchases, and open guides |
| Preparing to return | Review what remains, account for purchases and gifts, and pack return bags |
| Traveling home | Check departure essentials again and confirm bags after arrival |
| Completed | Resolve missing items, record lessons, and archive the trip |

Support optional stops such as Makkah and Madinah in an ordered itinerary. A stop can have dates, accommodation details, transport notes, and organizer-defined milestones. Hajj trips can add their own preparation and movement milestones. These notes do not automatically assert that a religious obligation is complete.

Outbound and return are separate travel legs with separate packing records. The same physical bag and item can participate in both legs.

## Checklist items and tasks

Each item should support:

- A name, category, quantity, and simple unit such as pieces, pairs, or sets.
- The traveler, family, or group that needs it.
- One responsible member, with the ability to reassign it.
- A priority, optional due date, and short notes.
- Whether it belongs on the outbound list, return list, or both.
- Preparation progress, current bag allocations, and a small activity history.
- Optional purchase notes and expected delivery date.

Start with editable categories for travel documents, clothing and ihram, footwear, toiletries, health essentials, electronics, prayer accessories, children and elders, shared supplies, and return purchases. Families can rename categories and add their own.

Some checklist entries are tasks rather than things to pack. Examples include checking a booking, saving an address, choosing a guide to save offline, charging a power bank, and checking the room before leaving. Tasks use `To do`, `In progress`, and `Done`, with an option to mark them `Not needed`. They never require a bag assignment.

Templates are suggestions. Members choose which entries apply. Requirements that depend on a travel date, operator, authority, or personal circumstances need a source and a last-reviewed date rather than an app-wide claim that they always apply.

## Item preparation lifecycle

Preparation and packing are separate. Receiving an order must not mark it as packed, and moving an item between bags must not change its purchase history.

The app should support these preparation labels:

| Label | Meaning | Counts as physically available? |
| --- | --- | --- |
| Remaining | This quantity still needs to be arranged | No |
| Ordered | An order has been placed and the quantity is expected | No |
| Delivered | Delivery has been reported, but a member has not checked the item | No |
| Bought | A member bought the item in person and has it | Yes |
| Received | A member checked and accepted a delivery, gift, or borrowed item | Yes |
| Already available | The family already owns the item and has checked that it is available | Yes |

An online purchase starts as `Ordered`, even if payment is complete. An in-person purchase that is still awaiting pickup also remains expected until someone has it. The visible `Bought` action is for an item that is physically with the family.

Common paths are:

- A delivery goes from `Remaining` to `Ordered`, then `Delivered`, then `Received`.
- A shop purchase goes from `Remaining` to `Bought`.
- An item already at home goes from `Remaining` to `Already available` after someone checks it.
- A borrowed or gifted item goes from `Remaining` to `Received` when someone takes possession.

Allow members to skip intermediate steps when recording something that has already happened. An order can be marked `Received` directly after inspection. Keep who changed it and when, and allow corrections.

Track quantities within an item rather than forcing the entire row into one status. For four required adapters, the app might show one already available, one received, one ordered, and one still to arrange. Each unit occupies one current preparation state so the counts cannot overlap.

Show these summaries separately:

- `Still to arrange` is the quantity with no available item or active order.
- `Awaiting receipt` is the quantity ordered or reported delivered but not checked.
- `Available` is the quantity bought, received, or already available.
- `Remaining to be ready` includes everything not yet physically available.

For the adapter example, one remains to arrange, one awaits receipt, and two remain to be ready. Ordering something reduces shopping work but does not make the family ready to leave.

Canceled orders and rejected or returned deliveries put the affected quantity back into `Remaining` unless a replacement is already recorded. Reduce quantities or mark an entry `Not needed` explicitly when plans change, with a reason retained in history.

## Packing and bag lifecycle

Create bags with recognizable names such as "Dad's cabin bag", "Family suitcase 1", and "Children's backpack". Store the carrier, bag type, optional identifying note or photo, and an optional self-entered weight and allowance note.

For each travel leg, an available item can be:

| Packing state | Meaning |
| --- | --- |
| Not packed | The item is available but has no confirmed carrying location for this leg |
| Packed in a bag | A member put a specified quantity into a named bag |
| Kept with a traveler | A member confirmed a specified quantity is with a named traveler, such as a passport or phone |
| Removed / needs repacking | A previously packed quantity was taken out and needs another check |

The main action is `Add to bag`, followed by a bag picker and quantity. Also offer `Keep with traveler`, `Move to another bag`, and `Remove from bag`. Packing should take only a few taps from the checklist.

One item can be split across bags. Each physical unit has one carrying location per leg. The app must prevent packing more than the available quantity or assigning the same quantity to two bags. An attempt to pack an unconfirmed purchase should offer to confirm its availability first.

A trip-shared bag can contain only trip-shared items. Packing a family-only item into one requires an explicit sharing decision by a permitted family coordinator first. Publishing a bag must not automatically publish its family-only contents. An item cannot become family-only while it remains allocated to a trip-shared bag; move or remove it first. Sharing an item also must not reveal an unshared bag or unrelated private contents.

A bag can move through `Packing`, `Ready`, `In transit`, and `Collected`. These are manual confirmations. The app must not infer that every item arrived simply because a flight landed. Taking something out of a ready bag flags the bag for review.

Bag views should show their contents, quantities, carrier, readiness, and unresolved items. Search should answer questions such as "Which bag has the charger?" with the last confirmed location and travel leg.

## Outbound preparation

The outbound checklist starts with the selected template and the family's additions. It should support:

- A shopping view for quantities still to arrange.
- An orders view for expected deliveries and overdue receipt checks.
- A personal or family view for assigned responsibilities.
- A packing view grouped by bag or traveler.
- A final departure check for essentials that must remain accessible.

Departure checks should be short, editable, and manually confirmed. They can include having travel documents with the designated traveler, saving hotel details offline, confirming transport notes, and checking that all expected bags are present.

Keep preparation, packing, and task progress separate. Show the underlying counts and any essential items still unresolved. A high overall percentage must not hide one missing essential.

## During the trip and return preparation

Keep the outbound record as history. When return preparation starts, propose a return checklist from reusable items and ask a member to review it. Do not copy outbound packing completion into the return leg.

For each item, the family can record how much they still have, how much they intend to bring home, and any quantity consumed, gifted, left behind intentionally, or lost. New purchases made during the stay can join the return list immediately. A replacement is a new available quantity with its own history.

Examples of return work include:

- Finding chargers, footwear, clothing, and other items across rooms and bags.
- Packing gifts and other purchases made at the destination.
- Checking borrowed items that need to go home with the family.
- Checking the room, safe, cupboards, and charging points before checkout.
- Keeping departure essentials accessible again.
- Confirming that the family collected its bags after arriving home.

Outbound availability does not prove that an item is still present. The return list starts with an unverified current quantity. A member must confirm it before packing. Any consumed, gifted, or missing quantities need an explicit disposition so the app can explain why the return quantity differs.

Airline and destination restrictions belong in dated notes or attached guidance supplied by the family or organizer. The app should not invent baggage allowances or present a purchase as automatically permitted for transport.

## Family collaboration and travel sharing

An organizer creates a private trip and targets invitations to a specific verified email or existing username. The organizer approves trip admission, and a family coordinator approves access to their family's content. An invitation link or code is a way for its intended recipient to accept approved access; forwarding it does not authorize a different account to join. Members should see the intended trip, family, and role before accepting.

Provide `My items`, `My family`, and `Shared with trip` filters. Each filter shows only content the member is permitted to access. A shared item has one record with several beneficiaries so each family does not buy it again by mistake. Show the responsible member next to every shared item.

Updates should identify the member and action, such as "Amina received 2 adapters" or "Yusuf moved the charger to Family suitcase 1". Keep the activity feed short and searchable by item. Routine updates belong in the app; notifications are for assignments, approaching deadlines, and important trip changes.

Members can share a selected travel summary through Android's share sheet. The summary can include dates, transport references, accommodation, and organizer contact details after a preview of the exact contents. Family membership, checklist access, and guide access require an invitation. A shared text summary grants none of those permissions.

Allow the organizer to revoke invitations and remove members. Apply permissions to the backend and file operations as well as the UI. Removing a member stops future remote access and synchronization when their device reconnects. Clear app-managed copies the member can no longer access after permission refresh; an offline device cannot receive that revocation immediately, and copies exported to device files remain outside the app's control.

## Shared travel guide library

Members should be able to open the trip's guide documents from a dedicated `Guides` tab. An organizer or permitted contributing member can add a PDF, image, text note, or external link.

Each guide has a title, category, optional description, contributor, update date, optional source, and an audience of either one family or the whole trip. New family guides default to the family audience, and sharing with the whole trip is explicit. Trip members with edit access can update trip-shared guides; viewers can read them. Only the owning family's coordinators can change sharing permissions, and organizing the trip does not bypass family-private access.

Useful guide content includes:

- An Umrah guide chosen by the family or their travel organizer.
- Hajj preparation and itinerary documents for Hajj trips.
- Travel organizer instructions and meeting-point notes.
- Flight, hotel, and local transport instructions.
- Family meeting plans and useful contact information.
- A packing reference or family-specific preparation note.

The primary action on a document or image is `Open`, which displays it inside the app. Do not launch a browser download, open an external file app, or save into Android Downloads as part of this default action. The viewer may fetch file bytes into memory or an app-private temporary cache as needed. External guide links use Android's normal link handling and require connectivity; adding a link does not create a downloadable copy of the linked site.

Offer secondary actions for members who need a saved copy. `Save offline in app` keeps a persistent copy in app-private storage, and `Download to device` explicitly saves a copy to a user-chosen device location. Both require the user's action and current guide access. Keep them separate from opening the guide, and show file size and progress when saving.

Do not bulk-download files when the library opens, the app starts, or trip data refreshes. A trip-level `Prepare for offline use` action may save only guides the member explicitly selects, alongside cached travel details, and must report failures. Mark a guide `Available offline` only after its persistent app-private copy is verified; a temporary viewing cache alone does not qualify.

When a contributor replaces a guide, show that an update is available. Keep the existing saved offline version until the member requests its update and the new copy finishes saving. Uploads that fail stay as retryable drafts and are not presented to others as usable documents.

Use ordinary document titles and metadata search for the first release. Document text search, read receipts, audio, and video can wait. Sharing a guide grants access inside its audience; downloading or exporting the underlying file is a separate, explicit action.

The first release is a guide library. A vault for identity documents and an AI-generated religious adviser are outside its scope. Families choose their guidance sources, and the app displays the contributor and source where supplied.

## Travel details and reminders

Store a compact itinerary with departure and arrival dates, time zones, transport details, accommodation addresses, meeting points, and useful contacts. Support manual entry and optional attachments. Keep this information available offline after a successful sync.

Members can set reminders for an assignment, an expected delivery, departure preparation, and return packing. Each reminder needs an owner, a clear time zone, and a way to dismiss or reschedule it. Updating the itinerary should prompt a review of affected reminders.

Request Android notification permission when a member enables a reminder. The checklists must remain usable if permission is declined. Do not depend on a notification arriving at an exact minute for a critical travel action.

## Online editing, offline viewing, and shared data reliability

Offline viewing is required for the first family trip. Once a trip is on the device, members can read its cached details, checklists, and last confirmed bag contents. Guides are reliably available offline only when a member explicitly saved them inside the app. Shared data changes require a connection, including item updates, packing, invitations, and document uploads. Offline trip screens are read-only and explain how to resume editing after reconnecting.

There is no offline write queue. A write can show `Saving` while online and `Saved` after the backend accepts it. If the connection fails, explain whether the change failed or its outcome needs checking. Keep unsaved form input visibly separate from confirmed shared data and offer an explicit retry after reconnecting. Do not silently submit offline changes later.

Online writes must handle retries without duplicating purchases or packing actions. Several connected members can edit at the same time. Use server acceptance order to decide which valid edit is latest and apply only the fields submitted, without a mandatory stale-edit review step. A rename must not undo another member's quantity update. Every accepted write must still satisfy current permissions, available quantities, and bag-sharing constraints. Retain who changed the record and its history, and never accept overpacking or duplicate allocations.

Show the last successful refresh time for the trip. Cached information may be older than another family member's changes, so the app should say when it is offline. Refresh accessible data and permissions when the connection returns. A guide becomes available offline only after an explicitly requested persistent copy finishes saving, not merely because its title appears in the library or it was opened once.

Keep trips private by default, use authenticated access, protect remote file access, and keep personal data out of logs. Define account removal, trip deletion, and local cache removal before production. Provide a shareable checklist summary so the family can keep a simple fallback copy.

## Main screens

Use a trip switcher above four main destinations:

| Screen | Main contents and actions |
| --- | --- |
| Overview | Active phase, next departure, essentials still missing, family readiness, next actions, offline status |
| Checklist | Search, outbound or return selector, family filters, preparation and packing filters, add item or task |
| Bags | Named bags, contents, carriers, readiness, and the action to move an item |
| Guides | Shared documents, family audience, in-app viewing, optional saved copies, and guide updates |

Open travel details from the overview. Put members, invitations, the activity feed, and trip settings under the trip menu. Keep account settings and appearance preferences separate from a particular trip.

The overview should favor actionable counts such as "3 essentials need attention" and "2 deliveries await checking". Let a member open the exact items behind a count. Returning users should reopen their active trip and last useful view.

## Theme and visual direction

Use a calm, readable visual style suited to repeated checks while shopping, packing, and traveling. Identity can come from a deep green primary color, warm neutral backgrounds, and restrained geometric details in onboarding or empty states. Dense checklist rows and guide pages should stay plain enough to scan.

Define shared semantic theme tokens for backgrounds, raised panels, text, secondary text, borders, primary actions, focus, success, pending work, and errors. Give every token a light and dark value. Support `Use device theme`, `Light`, and `Dark` in settings, and keep navigation bars, dialogs, sheets, forms, and document surroundings consistent.

Statuses need text and an icon as well as color. Green should not make `Received` and `Packed` look like the same state. Keep body text readable, honor Android font scaling, support TalkBack, and use touch targets of at least 48 dp. Test contrast, large text, and narrow Android screens before release.

Use familiar Android back behavior, system file picking, the share sheet, and permission prompts. Provide clear empty, loading, error, offline, and retry states. English is the initial interface language; preserve readable Arabic text in guides and prepare strings for later localization without promising a translated interface in the first release.

## Useful animation and feedback

Animation should explain a change or confirm an action while allowing the member to keep working.

| Interaction | Intended feedback |
| --- | --- |
| Update preparation status | Change the label immediately with a brief highlight and optional light haptic |
| Add an item to a bag | Update the item's location and bag count together, with an undo action |
| Move an item between bags | Show the destination bag and retain the member's position in the list |
| Change outbound or return view | Use a short transition while keeping the active leg label visible |
| Open item details or the bag picker | Use a consistent sheet transition with an accessible close action |
| Receive another member's change | Update the relevant row without jumping the scroll position |
| Save a guide offline or download it | Show actual progress only after the requested action, with a stable completed state |

Start with brief transitions around 150 to 250 ms and adjust on physical Android devices. Respect reduced-motion preferences, offer a static equivalent, and keep haptics optional. Avoid looping decoration, confetti for routine checks, or animations that delay a frequent action. Screen-reader announcements must describe the resulting state.

## React Native implementation direction

Build the first app with React Native and TypeScript for Android using Expo development builds. Configure EAS Update before distributing the first public APK, and confirm document viewing, local storage, file downloads, notifications, and sharing on physical devices before committing to particular libraries.

Distribute the initial app through public APK downloads. Compatible updates can arrive through EAS Update; native/runtime changes require another APK build. See [ADR-0003](adr/0003-ota-support-in-first-android-build.md) and [ADR-0005](adr/0005-distribute-public-apks-initially.md).

The public download must be a signed release APK. Development clients are for development and testing. Preserve the production package name and release signing identity across APK upgrades, and register the release package and signing-certificate fingerprint for Google sign-in. These requirements follow [Expo's build configuration](https://docs.expo.dev/eas/json/), [Android's signing rules](https://developer.android.com/studio/publish/app-signing), and [Google's client authentication requirements](https://developers.google.com/android/guides/client-auth).

The app needs a persistent read cache, an authenticated shared backend, private file storage, and a consistent navigation and theme system. Shared writes go to the backend while online; do not build an offline edit queue for this release. Validate that two connected Android devices can update the same trip without corrupting quantities or bag assignments and can reopen cached content offline.

Use Neon for PostgreSQL only and Clerk for hosted authentication. The authenticated API uses a Next.js boilerplate deployed to Vercel, separate from the Expo Android app. Do not add Neon Functions or Neon Object Storage. Files use a private Cloudflare R2 bucket, with file metadata in Neon and access checked by the Next.js API. Provider choices must preserve verified identity linking, family access boundaries, private emails, and case-insensitive username uniqueness.

Use `travel.nmtsolutions.in` as the selected Clerk production application domain. Clerk production setup for the Expo app still needs the instance's DNS configuration, even without a separate website. See [Clerk's Expo deployment guide](https://clerk.com/docs/guides/development/deployment/expo).

The Android app name is `NMT Travel` and the application ID is `in.nmtsolutions.travel`, matching `travel.nmtsolutions.in`. Use the same package and production signing identity for Google OAuth registration and later APK upgrades.

Authorize direct R2 uploads rather than routing file bytes through a Next.js Function. Vercel Functions have a 4.5 MB request-body limit, so the 20 MB file limit needs direct storage uploads. Issue narrowly scoped, short-lived R2 authorization only after checking the relevant family/trip permission; keep R2 credentials server-side and public bucket access disabled. For reads, the app controls whether bytes are used only by the viewer, explicitly saved offline, or explicitly downloaded to device files. See [Vercel Function limits](https://vercel.com/docs/functions/limitations) and [R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/).

Downloaded EAS updates apply at the next app start, with an optional `Restart to update` action. Keep an active packing or guide-reading session running until the member chooses to restart or starts a new session.

Keep these concepts distinct in the data model:

- A trip, its member accounts, family groups, and traveler profiles.
- Travel legs and itinerary stops.
- Checklist items and non-packing tasks.
- Quantity records for preparation and changes in possession.
- Physical bags and each leg's packing allocations.
- Guide metadata, versions, audiences, explicitly saved offline copies, and requested device downloads.
- Activity records, reminders, and online write requests.

Acquisition history belongs to the item. Packing confirmation belongs to a travel leg. An outbound packing action must never satisfy a return requirement. Bag moves and quantity changes need atomic validation when the server accepts them.

Do not build a general travel configuration system yet. Revisit broader travel support after the family's completed Umrah trip, while preserving its original records.

## Release sequence

1. Validate the core model with one family's outbound and return examples, including split quantities, delayed orders, and shared bags.
2. Set up the Android app, native capabilities, signing, and EAS Update, then build screens for travelers, items, preparation, tasks, bags, and return packing.
3. Add accounts, invitations, family sharing, online writes, read caching, and concurrent-edit handling. Exercise these on two devices before adding more features.
4. Add travel details, shared guides with in-app viewing, optional offline saving and device downloads, and the offline preparation check.
5. Finish theming, motion, accessibility, reminders, and production recovery paths. Install the build on the family's actual phones and complete a practice packing session.

This is an implementation order for the requested complete active launch scope, including file features through a separate storage host. The first usable APK is requested for November 14, 2026, and must already support OTA. Compatible improvements and fixes can continue after launch; there is no fixed pre-departure feature freeze.

## First production acceptance checks

These checks describe the requested first-production target, including file-dependent features. Detailed scenarios will be refined during implementation.

- A new user can sign up publicly and start their own trip.
- The installed app is named `NMT Travel` with package ID `in.nmtsolutions.travel`.
- Google and email-code sign-up collect first name, last name, username, and email, including missing fields after Google sign-in.
- A username cannot be registered twice with different casing, email addresses are not exposed to other members, and both sign-in methods for the same verified email retain the same account and memberships.
- A signed public APK can be installed, and the first distributed build receives a compatible EAS Update without reinstalling it.
- An approved invitation grants the intended trip access. Another family cannot read family-only checklist entries, bags, or guide files until those records are explicitly shared.
- A forwarded invitation cannot grant access to a different recipient. Trip admission and family access require approval from the appropriate organizer and coordinator.
- A trip organizer cannot read or edit another family's private content without that family's explicit permission.
- The organizer can create an Umrah trip, add relatives without accounts, and invite a second account into the same family.
- A second family can join the trip. Members can filter responsibilities by family, and viewers cannot change data.
- One shared item can serve several travelers without becoming duplicate shopping entries.
- A member can record partial purchases, expected quantities, delivered parcels, and verified receipts with correct remaining counts.
- A member can pack available quantities across two bags, keep an essential with a traveler, move an item, and undo a mistake without duplicate allocations.
- Return preparation starts unverified. It accounts for reusable items, consumed quantities, gifts, missing items, and new destination purchases without changing outbound history.
- A permitted member can add a PDF or image guide, choose its audience, and let another authorized member open it inside the app. An unauthorized family cannot fetch a family-only file.
- Opening a guide, refreshing the library, or starting the app does not automatically save files to device folders or mark guides available offline. The viewer is the default action, with optional saving and download actions.
- An explicitly saved app-private guide and cached itinerary open in airplane mode after the app restarts. Failed saves remain visibly incomplete, and a temporary viewing cache alone does not mark a guide available offline.
- A member can explicitly download a permitted guide to a chosen device location when needed.
- Trip data is read-only offline, no offline write queue exists, and cached content remains readable after an app restart. Online edits show confirmed success or a clear failure. Valid competing edits follow the agreed latest-edit-wins policy while preserving permission, quantity, and allocation constraints.
- Concurrent changes to different fields are both retained. The latest server-accepted valid change wins on an overlapping field, and only family coordinators can change content visibility.
- Each family has a coordinator, and adding a family-only item to a trip-shared bag requires explicit sharing first.
- An OTA update does not interrupt an active packing or guide-reading session and can be applied on the next start or a requested restart.
- Removing a member prevents further remote access. The UI explains the limits of recalling downloaded or exported copies.
- Light and dark themes, enlarged text, TalkBack, reduced motion, Android back navigation, and declined notification permission all leave the main flows usable.
- The family can install and update the Android build before departure without losing trip data. At least one backup and recovery exercise succeeds.
- After arriving home, the family can account for its bags, resolve outstanding items, archive the trip, and save notes for the next journey.

## What to learn from the Umrah trip

Record whether family members could prepare their own items, locate belongings, use guides without connectivity, and pack for the return without rebuilding lists in chat. Note every occasion where someone needed a separate spreadsheet or message to explain the app's data.

After the trip, review which statuses people actually used, where sharing caused confusion, which offline operations failed, and whether reminders helped. Use that evidence to refine Hajj and Umrah support before deciding how to introduce general travel.
