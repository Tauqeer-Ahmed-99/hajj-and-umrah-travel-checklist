import { useCallback, useEffect, useState } from "react";
import { Alert, AppState, BackHandler, Linking } from "react-native";
import { useSessionAuth } from "./session-auth";
import { randomUUID } from "expo-crypto";
import {
  reminderCategory,
  reminderCategoryLabels,
  reminderInput,
  reminderPatch,
  type Reminder,
  type ReminderInput,
  type ReminderPatch,
  type NotificationPreferences,
  type TripDetail,
  type AccessMember,
  type ChecklistEntry,
} from "@nmt/contracts";
import { Action, Copy, Field, Heading, Loading, Notice, Screen } from "./ui";
import { ChecklistChoices, ChecklistSection } from "./checklist-ui";
import { useTripRequest } from "./use-trip-request";
import { reminderApi } from "./reminder-api";
import { tripApi } from "./trip-api";
import { invitationApi } from "./invitation-api";
import { checklistApi } from "./checklist-api";
import {
  requestNotificationPermission,
  synchronizeNotifications,
  uncertainReminderSchedules,
} from "./native-notifications";

export function RemindersScreen({
  tripId,
  memberId,
  onBack,
}: {
  tripId: string;
  memberId: string;
  onBack: () => void;
}) {
  const api = useTripRequest();
  const { getToken, sessionId } = useSessionAuth();
  const [data, setData] = useState<{
    reminders: Reminder[];
    detail: TripDetail;
    members: AccessMember[];
    preferences: NotificationPreferences;
    uncertainDelivery: boolean;
    uncertainSchedules: string[];
  } | null>(null);
  const [form, setForm] = useState<Reminder | "new" | null>(null);
  const [notice, setNotice] = useState("");
  const [deviceBusy, setDeviceBusy] = useState(false);
  const load = useCallback(async () => {
    const result = await api.run(async (token, signal) => {
      const [reminders, detail, members, notifications] = await Promise.all([
        reminderApi.list(tripId, token, signal),
        tripApi.read(tripId, token, signal),
        invitationApi.members(tripId, undefined, token, signal),
        reminderApi.preferences(token, signal),
      ]);
      return {
        ...reminders,
        detail,
        members: members.members,
        preferences: notifications.preferences,
        uncertainDelivery: notifications.deliveries.some(
          (d) => d.state === "unknown",
        ),
        uncertainSchedules: sessionId
          ? await uncertainReminderSchedules(memberId, sessionId).catch(
              () => [],
            )
          : [],
      };
    });
    if (result) setData(result);
    else setData(null);
  }, [api.run, tripId, memberId, sessionId]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "active" && !form && !deviceBusy) void load();
    });
    return () => listener.remove();
  }, [load, form, deviceBusy]);
  useEffect(() => {
    if (form) return;
    const listener = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!api.busy) onBack();
      return true;
    });
    return () => listener.remove();
  }, [form, onBack, api.busy, deviceBusy]);
  async function refreshDevice(permission = false) {
    if (deviceBusy) return;
    setDeviceBusy(true);
    try {
      if (permission && !(await requestNotificationPermission())) {
        setNotice(
          "Notifications are off. You can keep using every checklist and travel screen. Use Android settings if you change your mind.",
        );
        return;
      }
      const token = await getToken();
      if (token && sessionId)
        setNotice(
          await synchronizeNotifications(
            memberId,
            sessionId,
            token,
            AbortSignal.timeout(15000),
          ),
        );
    } catch {
      setNotice(
        "The reminder is saved in the app. Device scheduling could not be confirmed. Reconnect and refresh notifications.",
      );
    } finally {
      setDeviceBusy(false);
    }
  }
  async function change(id: string, patch: ReminderPatch) {
    const result = await api.run((token, signal) =>
      reminderApi.patch(tripId, id, patch, token, signal),
    );
    if (result) {
      setNotice("Saved");
      await refreshDevice();
      await load();
    }
  }
  async function preference(key: keyof NotificationPreferences) {
    if (!data) return;
    const result = await api.run((token, signal) =>
      reminderApi.setPreferences(
        { [key]: !data.preferences[key] },
        token,
        signal,
      ),
    );
    if (result) {
      setData({ ...data, preferences: result.preferences });
      await refreshDevice();
    }
  }
  if (form && data)
    return (
      <ReminderForm
        tripId={tripId}
        memberId={memberId}
        detail={data.detail}
        existing={form === "new" ? null : form}
        onCancel={() => {
          setForm(null);
          void load();
        }}
        onSaved={() => {
          setForm(null);
          setNotice("Saved");
          void refreshDevice().then(load);
        }}
      />
    );
  return (
    <Screen>
      <Action
        title="Back to trip"
        secondary
        disabled={api.busy}
        onPress={onBack}
      />
      <Heading>Reminders</Heading>
      <Copy>
        Keep travel checks in your checklist and itinerary. Notifications may be
        delayed or missed; they never confirm a delivery or that a bag is
        packed.
      </Copy>
      {notice !== "" && <Notice>{notice}</Notice>}
      {api.error && <Notice error>{api.error.message}</Notice>}
      {!data && !api.error && <Loading message="Opening reminders…" />}
      {data && (
        <>
          <Action
            requiresConnection
            title="Add reminder"
            disabled={api.busy || deviceBusy}
            onPress={() => setForm("new")}
          />
          {data.reminders.length === 0 && (
            <Copy>
              No reminders yet. Add a preparation check with an owner and a
              named time zone.
            </Copy>
          )}
          {data.reminders.map((r) => (
            <ChecklistSection key={r.id} title={r.title}>
              <Copy>
                {reminderCategoryLabels[r.category]} ·{" "}
                {r.dismissed
                  ? "Dismissed"
                  : r.needsReview
                    ? "Review needed after trip change"
                    : "Active"}
              </Copy>
              <Copy>
                Owner:{" "}
                {r.ownerMemberId === memberId
                  ? "You"
                  : (data.members.find((m) => m.id === r.ownerMemberId)
                      ?.username ?? "Trip member")}
              </Copy>
              <Copy>
                {r.dueAt.dateTime.replace("T", " ")} · {r.dueAt.timeZone}
              </Copy>
              {r.familyId && <Copy muted>Family checklist reference</Copy>}
              {data.uncertainSchedules.includes(r.id) && (
                <Notice error>
                  Device scheduling could not be confirmed. Reschedule this
                  reminder to a new time to try again.
                </Notice>
              )}
              {r.ownerMemberId === memberId && (
                <>
                  <Action
                    requiresConnection
                    title={`Reschedule ${r.title}`}
                    secondary
                    disabled={api.busy || deviceBusy}
                    onPress={() => setForm(r)}
                  />
                  {r.needsReview && (
                    <Action
                      requiresConnection
                      title={`Confirm reviewed ${r.title}`}
                      secondary
                      disabled={api.busy || deviceBusy}
                      onPress={() =>
                        void change(r.id, { reviewedVersion: r.version })
                      }
                    />
                  )}
                  {!r.dismissed && (
                    <Action
                      requiresConnection
                      title={`Dismiss ${r.title}`}
                      secondary
                      disabled={api.busy || deviceBusy}
                      onPress={() => void change(r.id, { dismissed: true })}
                    />
                  )}
                </>
              )}
            </ChecklistSection>
          ))}
          <ChecklistSection title="Notification preferences">
            <Copy>
              Optional alerts use generic text on this device. Routine activity
              stays in the app.
            </Copy>
            {(
              [
                ["assignments", "Important assignments"],
                ["deadlines", "Reminders and deadlines"],
                ["tripChanges", "Trip changes"],
              ] as const
            ).map(([key, label]) => (
              <Action
                requiresConnection
                key={key}
                title={`${label}: ${data.preferences[key] ? "On" : "Off"}`}
                secondary
                disabled={api.busy || deviceBusy}
                onPress={() => void preference(key)}
              />
            ))}
            <Action
              title="Enable notifications on this device"
              busy={deviceBusy}
              disabled={api.busy}
              onPress={() => void refreshDevice(true)}
            />
            <Action
              title="Android notification settings"
              secondary
              onPress={() => void Linking.openSettings()}
            />
            <Action
              title="Refresh notifications"
              secondary
              busy={deviceBusy}
              disabled={api.busy}
              onPress={() => void refreshDevice()}
            />
            {data.uncertainDelivery && (
              <Notice>
                A notification’s provider outcome could not be confirmed. It
                will not be automatically sent again. Check your reminders and
                itinerary here.
              </Notice>
            )}
          </ChecklistSection>
        </>
      )}
      <Action
        title="Refresh reminders"
        secondary
        busy={api.busy}
        disabled={deviceBusy}
        onPress={() => void load()}
      />
    </Screen>
  );
}

function ReminderForm({
  tripId,
  memberId,
  detail,
  existing,
  onCancel,
  onSaved,
}: {
  tripId: string;
  memberId: string;
  detail: TripDetail;
  existing: Reminder | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const api = useTripRequest();
  const references = useTripRequest();
  const [requestId] = useState(randomUUID);
  const [title, setTitle] = useState(existing?.title ?? "");
  const [category, setCategory] = useState<Reminder["category"]>(
    existing?.category ?? "departure_preparation",
  );
  const [dateTime, setDateTime] = useState(existing?.dueAt.dateTime ?? "");
  const [timeZone, setTimeZone] = useState(existing?.dueAt.timeZone ?? "");
  const [ownerMemberId, setOwner] = useState(memberId);
  const [familyId, setFamily] = useState<string>(existing?.familyId ?? "trip");
  const [entryId, setEntry] = useState<string>(existing?.entryId ?? "none");
  const [members, setMembers] = useState<AccessMember[]>([]);
  const [entries, setEntries] = useState<ChecklistEntry[]>([]);
  const [validation, setValidation] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<ReminderInput | ReminderPatch | null>(
    null,
  );
  const uncertain =
    !!pending &&
    !!api.error &&
    (api.error.status === 0 || api.error.status >= 500);
  const locked = api.busy || uncertain || api.readOnly;
  useEffect(() => {
    if (existing) return;
    let current = true;
    setMembers([]);
    setEntries([]);
    void references
      .run(async (token, signal) => {
        const roster = await invitationApi.members(
          tripId,
          familyId === "trip" ? undefined : familyId,
          token,
          signal,
        );
        const list =
          familyId === "trip"
            ? []
            : (await checklistApi.read({ tripId, familyId }, token, signal))
                .entries;
        return { members: roster.members, entries: list };
      })
      .then((result) => {
        if (current && result) {
          setMembers(result.members);
          setEntries(result.entries);
        }
      });
    return () => {
      current = false;
    };
  }, [familyId, tripId, existing, references.run]);
  const cancel = useCallback(() => {
    if (!api.busy)
      Alert.alert(
        uncertain ? "Check saved reminders?" : "Leave reminder form?",
        uncertain
          ? "The save may already be accepted. Refresh before starting another change."
          : "Unsaved details will be cleared.",
        [
          { text: "Keep editing", style: "cancel" },
          {
            text: uncertain ? "Check saved reminders" : "Leave form",
            onPress: onCancel,
          },
        ],
      );
  }, [api.busy, uncertain, onCancel]);
  useEffect(() => {
    const listener = BackHandler.addEventListener("hardwareBackPress", () => {
      cancel();
      return true;
    });
    return () => listener.remove();
  }, [cancel]);
  async function save() {
    const draft: Record<string, unknown> = {};
    if (existing) {
      draft.requestId = requestId;
      if (title.trim() !== existing.title) draft.title = title;
      if (
        dateTime !== existing.dueAt.dateTime ||
        timeZone !== existing.dueAt.timeZone
      )
        draft.dueAt = { dateTime, timeZone };
      if (existing.dismissed) draft.dismissed = false;
      if (existing.needsReview) draft.reviewedVersion = existing.version;
    }
    const candidate = uncertain
      ? pending
      : existing
        ? draft
        : {
            requestId,
            title,
            category,
            dueAt: { dateTime, timeZone },
            ownerMemberId,
            familyId: familyId === "trip" ? null : familyId,
            entryId: entryId === "none" ? null : entryId,
          };
    const parsed = (existing ? reminderPatch : reminderInput).safeParse(
      candidate,
    );
    if (!parsed.success) {
      setValidation(
        Object.fromEntries(
          parsed.error.issues.map((i) => [
            String(i.path[0] ?? "form"),
            i.message,
          ]),
        ),
      );
      return;
    }
    setValidation({});
    setPending(parsed.data);
    const result = await api.run((token, signal) =>
      existing
        ? reminderApi.patch(
            tripId,
            existing.id,
            parsed.data as ReminderPatch,
            token,
            signal,
          )
        : reminderApi.create(
            tripId,
            parsed.data as ReminderInput,
            token,
            signal,
          ),
    );
    if (result) onSaved();
  }
  const canAssign =
    detail.trip.role !== "viewer" &&
    (familyId === "trip" ||
      detail.families.some((f) => f.id === familyId && f.canEdit));
  return (
    <Screen>
      <Heading>{existing ? "Reschedule reminder" : "Add reminder"}</Heading>
      <Field
        label="Reminder title"
        testID="reminder-title"
        value={title}
        onChangeText={setTitle}
        editable={!locked}
        error={validation.title ?? api.error?.fields?.title}
      />
      {!existing && (
        <>
          <ChecklistChoices
            label="Reminder category"
            options={reminderCategory.options.map((value) => ({
              value,
              label: reminderCategoryLabels[value],
            }))}
            value={category}
            onChange={setCategory}
            locked={locked}
          />
          <ChecklistChoices
            label="Reference scope"
            options={[
              { value: "trip", label: "Trip preparation" },
              ...detail.families.map((f) => ({ value: f.id, label: f.name })),
            ]}
            value={familyId}
            onChange={(id) => {
              setFamily(id);
              setEntry("none");
              setOwner(memberId);
            }}
            locked={locked || references.busy}
          />
          {references.error && (
            <Notice error>
              {references.error.message} Reopen the form to refresh reference
              choices.
            </Notice>
          )}
          <ChecklistChoices
            label="Reminder owner"
            options={members
              .filter((m) => canAssign || m.id === memberId)
              .map((m) => ({
                value: m.id,
                label: `${m.firstName} ${m.lastName} (@${m.username})`,
              }))}
            value={ownerMemberId}
            onChange={setOwner}
            locked={locked || references.busy}
          />
          {familyId !== "trip" && (
            <ChecklistChoices
              label="Checklist reference (optional)"
              options={[
                { value: "none", label: "No item or task reference" },
                ...entries.map((e) => ({ value: e.id, label: e.title })),
              ]}
              value={entryId}
              onChange={setEntry}
              locked={locked || references.busy}
            />
          )}
        </>
      )}
      <Field
        label="Reminder date and time with UTC offset"
        testID="reminder-time"
        hint="For example 2026-11-20T09:00:00+03:00. Use the offset for the named zone on that date."
        value={dateTime}
        onChangeText={setDateTime}
        autoCapitalize="none"
        editable={!locked}
        error={validation.dueAt ?? api.error?.fields?.dueAt}
      />
      <Field
        label="Named time zone"
        testID="reminder-zone"
        hint="For example Asia/Riyadh or Asia/Kolkata. Device zone changes do not move this instant."
        value={timeZone}
        onChangeText={setTimeZone}
        autoCapitalize="none"
        editable={!locked}
      />
      {validation.form && <Notice error>{validation.form}</Notice>}
      {api.error && <Notice error>{api.error.message}</Notice>}
      {uncertain && (
        <Notice>
          The save may already be accepted. Details are held for a safe retry,
          or cancel to check saved reminders.
        </Notice>
      )}
      <Action
        requiresConnection
        title={uncertain ? "Retry same reminder save" : "Save reminder"}
        busy={api.busy}
        disabled={references.busy}
        onPress={() => void save()}
      />
      <Action title="Cancel" secondary disabled={api.busy} onPress={cancel} />
    </Screen>
  );
}
