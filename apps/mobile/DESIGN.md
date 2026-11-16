# NMT Travel mobile interface

The supplied CivicOne reference images (43576–43585) define this interface. Use
their mobile composition and typography for travel content. Keep NMT Travel’s
name and actual domain behavior; do not introduce government identity claims,
invented journeys, counts, verification badges or readiness guarantees.

## Foundation

| Role                 | Light appearance       |
| -------------------- | ---------------------- |
| Primary action       | Civic blue `#3156E9`   |
| Card                 | Pure white `#FFFFFF`   |
| Canvas               | Soft surface `#F6F8FC` |
| Text and dark anchor | Deep navy `#17283A`    |

Bundle Urbanist Regular, Medium, SemiBold and Bold. Use the shared `Text`
component to select real font faces on Android. Use the regular face for native
inputs. Keep system font scaling enabled. Reader content keeps a larger reading
size and native fallback for scripts outside Urbanist’s coverage.

Dark appearance uses navy surfaces and readable lighter text/accent colors.
Solid action buttons retain civic blue and white text. Appearance preferences
belong in Profile; onboarding and authentication have no appearance controls.

## Composition

- Use the shared `Screen` with 20dp horizontal margins and 16dp content gaps.
  Do not repeat a large logo or divider above each screen.
- Home uses an avatar/greeting, compact search/reminder actions, a short heading,
  one feature card and four small action tiles. Feature cards show actual
  authorized trip data, or an honest first-trip invitation.
- Root tabs are Home, Trips, Guides and Profile. The floating surface has a
  solid blue selected pill. Tabs retain their mounted screens and drafts.
  Only the focused screen consumes Android Back.
- Trip destinations use a compact category strip within trip content, not a
  second bottom navigation bar. Keep existing remembered destinations.
- Use `Surface`, `ListRow`, `QuickTile`, `PageHeader` and `JourneyCard` from
  `design-system.tsx`. Corners are 18–24dp; borders and shadows are restrained.
- Guide libraries use document cards, with a single column on narrow screens
  or at large font settings. A type illustration is not a downloaded preview.
- Checklist entries and bags show a concise summary. Expand a row to inspect
  quantities, physical confirmations, history and management actions.
- Reserve filled, full-width actions for the primary step. Secondary controls
  use compact outlined pills or list rows. All interactive targets are at least
  48dp tall. Forms remain keyboard-safe and scrollable.
- Calendar dates open Android’s native date picker. Zoned itinerary/reminder
  fields use native date and time pickers. Preserve the named destination zone;
  calculate its offset for the chosen date, reject daylight-saving gaps and ask
  for an explicit occurrence during an overlap. Do not reintroduce ISO text entry.

The blue passport illustration is decorative. The bundled raster asset was
generated for this app; it does not represent a real document or verification.

## Motion and feedback

Press feedback is subtle (120ms, opacity and transform). Authentication uses
native stack transitions. Honor reduced motion. Root tabs do not slide. Keep
loading, disabled, validation and error states readable without relying on color.
Do not claim physical-device motion performance from emulator evidence.

Content loading uses matching skeletons (screen, profile, list, document cards,
reader or inline). Their restrained opacity pulse stops for reduced motion.
Loading descriptions remain available to screen readers, without visible loading
text or page spinners. Every busy action uses a spinner inside its button and
prevents duplicate submission. Determinate file transfers use a progress bar;
the PDF dependency’s default spinner is disabled.

## Connectivity and privacy

Android’s internet-validation hint is not proof that a working cellular
connection is offline. A real HTTP response establishes service reachability;
the server independently authorizes every operation. Cancellation does not
establish loss of transport. A failed cached-resource refresh cannot globally
disable unrelated healthy requests.

Show a network/service banner only for a real unavailable transport. Keep
server errors in the affected view. Do not bypass profile, session, tombstone,
family, file-version or revocation guards. Never queue or replay offline saves.
Root catalogue entries disappear when trip access is definitively revoked.

Verify actual Android screens and connected/offline user journeys before
submitting a new preview binary; a typecheck alone does not establish UI quality.
