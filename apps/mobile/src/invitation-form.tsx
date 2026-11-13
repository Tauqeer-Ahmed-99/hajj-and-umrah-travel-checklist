import { useState } from "react";
import { Alert, Text } from "react-native";
import { randomUUID } from "expo-crypto";
import {
  invitationInput,
  type Invitation,
  type InvitationInput,
  type TripDetail,
  type TripRole,
  type FamilyRole,
} from "@nmt/contracts";
import { Action, Copy, Field, Heading, Notice, Screen } from "./ui";
import { useTripRequest } from "./use-trip-request";
import { invitationApi } from "./invitation-api";
import {
  AccessChoices,
  familyRoleChoices,
  tripRoleChoices,
  useAccessBack,
} from "./invitation-ui";
import { useTheme } from "./theme";

export function InvitationForm({
  detail,
  initialFamilyId,
  onBack,
  onSaved,
}: {
  detail: TripDetail;
  initialFamilyId?: string;
  onBack: () => void;
  onSaved: (i: Invitation) => void;
}) {
  const api = useTripRequest();
  const { colors } = useTheme();
  const [requestId] = useState(() => randomUUID());
  const [kind, setKind] = useState<"username" | "email">("username");
  const [value, setValue] = useState("");
  const [tripRole, setTripRole] = useState<TripRole>("member");
  const [familyId, setFamilyId] = useState(initialFamilyId ?? "none");
  const [familyRole, setFamilyRole] = useState<FamilyRole>("viewer");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<InvitationInput | null>(null);
  const uncertain =
    !!pending &&
    !!api.error &&
    (api.error.status === 0 || api.error.status >= 500);
  const locked = api.busy || uncertain || api.readOnly;
  const back = () => {
    if (api.busy) return;
    Alert.alert(
      uncertain ? "Check invitations?" : "Leave invitation?",
      uncertain
        ? "This invitation may already be saved. Check invitations before creating another. Nothing will be queued."
        : "Unsaved invitation details will be cleared.",
      [
        { text: "Keep editing", style: "cancel" },
        {
          text: uncertain ? "Check invitations" : "Leave form",
          onPress: onBack,
        },
      ],
    );
  };
  useAccessBack(back, api.busy);
  const save = async () => {
    const input =
      uncertain && pending
        ? pending
        : {
            requestId,
            recipient: { kind, value },
            tripRole,
            ...(familyId === "none" ? {} : { familyId, familyRole }),
          };
    const parsed = invitationInput.safeParse(input);
    if (!parsed.success) {
      setFields(
        Object.fromEntries(
          parsed.error.issues.map((i) => [
            String(i.path[0] ?? "form"),
            i.message,
          ]),
        ),
      );
      return;
    }
    setFields({});
    setPending(parsed.data);
    const result = await api.run((token, signal) =>
      invitationApi.create(detail.trip.id, parsed.data, token, signal),
    );
    if (result) onSaved(result.invitation);
  };
  return (
    <Screen>
      <Heading>Invite a member</Heading>
      <Copy>{detail.trip.name}</Copy>
      <Copy>
        Choose a specific recipient. They can review this offer in Your
        invitations after signing in with that account. Invitations expire after
        seven days.
      </Copy>
      <AccessChoices
        label="Address invitation to"
        value={kind}
        onChange={setKind}
        disabled={locked}
        choices={[
          { value: "username", label: "Existing username" },
          { value: "email", label: "Verified email" },
        ]}
      />
      <Field
        label={kind === "email" ? "Recipient email" : "Recipient username"}
        value={value}
        onChangeText={setValue}
        keyboardType={kind === "email" ? "email-address" : "default"}
        autoCapitalize="none"
        autoCorrect={false}
        editable={!locked}
        error={fields.recipient ?? api.error?.fields?.recipient}
        hint={
          kind === "email"
            ? "Only an account with this verified primary email can accept. Emails stay private."
            : "Use the member’s existing username, without @."
        }
      />
      <AccessChoices
        label="Trip access"
        value={tripRole}
        onChange={(role) => {
          setTripRole(role);
          if (role === "viewer") setFamilyRole("viewer");
        }}
        disabled={locked}
        choices={tripRoleChoices}
      />
      {!initialFamilyId && (
        <AccessChoices
          label="Family access"
          value={familyId}
          onChange={setFamilyId}
          disabled={locked}
          choices={[
            { value: "none", label: "No family access" },
            ...detail.families.map((f) => ({ value: f.id, label: f.name })),
          ]}
        />
      )}
      {familyId !== "none" && (
        <>
          <Copy>
            Family: {detail.families.find((f) => f.id === familyId)?.name}
          </Copy>
          <AccessChoices
            label="Family role"
            value={familyRole}
            onChange={setFamilyRole}
            disabled={locked}
            choices={
              tripRole === "viewer"
                ? familyRoleChoices.filter((c) => c.value === "viewer")
                : familyRoleChoices
            }
          />
          <Notice>
            Family access needs this family’s coordinator approval. Trip
            admission needs organizer approval.
          </Notice>
        </>
      )}
      {Object.entries(fields)
        .filter(([key]) => key !== "recipient")
        .map(([key, message]) => (
          <Notice key={key} error>
            {message}
          </Notice>
        ))}
      {api.error && <Notice error>{api.error.message}</Notice>}
      {uncertain && (
        <Notice>
          This invitation may already be saved. Retry the same details safely,
          or check invitations.
        </Notice>
      )}
      <Text style={{ color: colors.muted, fontSize: 16, lineHeight: 25 }}>
        A viewer can read. An editor can change permitted content. Coordinators
        manage family access; organizers manage the trip.
      </Text>
      <Action
        requiresConnection
        title={
          api.busy
            ? "Saving invitation…"
            : uncertain
              ? "Retry same invitation"
              : "Create invitation"
        }
        busy={api.busy}
        onPress={() => void save()}
      />
      <Action
        title={uncertain ? "Check invitations" : "Cancel invitation"}
        secondary
        disabled={api.busy}
        onPress={back}
      />
      <Copy muted>Changes need a connection. Nothing is queued for later.</Copy>
    </Screen>
  );
}
