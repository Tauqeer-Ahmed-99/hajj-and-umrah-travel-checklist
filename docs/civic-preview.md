# Reference UI and connectivity preview

Preview version code: **6**. The source identity and build link are recorded by
EAS when the signed build is submitted. The API remains
`https://nmt-travel-api.vercel.app`; this change does not require an API deployment.

## Included

- Urbanist and the supplied civic-blue/white/soft-surface/navy reference palette.
- Persistent Home, Trips, Guides and Profile tabs; compact cards, tiles, lists,
  expandable checklist/bag details, guide document cards and a travel mascot.
- Light, dark and system appearance in Profile, without an authentication picker.
- Content-shaped skeletons with reduced-motion support. Loading descriptions are
  accessible without visible loading text; spinners belong inside busy buttons.
  Asynchronous buttons own their pending feedback and reject duplicate taps.
- Native date pickers for trip dates, delivery dates, due dates and review dates.
  Itinerary/reminder date and time controls resolve the selected named zone,
  reject skipped DST times and request an explicit occurrence during overlaps.
- Cancellation no longer marks the service offline. Repeated connectivity hints
  preserve a working connection; Android’s internet-validation probe cannot
  overrule a working cellular transport. HTTP replies reestablish reachability.
  A cached-scope failure cannot block unrelated healthy requests. Real transport
  failures still block writes, and definitive session/access denials retain their
  cleanup guards. Offline writes are never queued or replayed.

## Verification before submission

| Check                                                        | Result                                               |
| ------------------------------------------------------------ | ---------------------------------------------------- |
| Complete HTTP/PostgreSQL API suite                           | 128/128 passed                                       |
| Mobile real-HTTP connectivity regressions                    | 7/7 passed                                           |
| Calendar/zone/DST conversion against actual shared contracts | 6/6 passed                                           |
| Workspace TypeScript                                         | Passed                                               |
| Android JavaScript export                                    | Passed; local bytecode compilation is policy-blocked |
| Expo Doctor                                                  | 20/20 passed                                         |
| Formatting and whitespace checks                             | Passed                                               |
| Preview project/public environment/native input checks       | Passed                                               |
| Reference layout/Urbanist native base                        | Observed on Android emulator                         |

The native base compiled locally before the final date-picker dependency and
skeleton additions. The final signed EAS APK must compile that dependency and
be inspected for package/version, expected certificate, runtime, API/Clerk
configuration, fonts, native modules and known server-secret absence. Native
picker interaction, final skeleton/keyboard behavior and motion on a physical
device remain for the requested device test; do not claim those from unit tests.

See [the design rules](../apps/mobile/DESIGN.md) for the shared component,
navigation, motion and loading conventions.
