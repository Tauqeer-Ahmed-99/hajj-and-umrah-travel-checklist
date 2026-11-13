import { useCallback, useState } from "react";
import { invitation, type Invitation } from "@nmt/contracts";
import { Action, Copy, Field, Heading, Loading, Notice, Screen } from "./ui";
import { invitationApi } from "./invitation-api";
import { useTripRequest } from "./use-trip-request";
import {
  AccessSection,
  InvitationDetails,
  useAccessBack,
  useAccessRefresh,
} from "./invitation-ui";

export function InvitationInbox({
  onBack,
  onOpenTrip,
}: {
  onBack: () => void;
  onOpenTrip: (id: string) => void;
}) {
  const api = useTripRequest();
  const [invitations, setInvitations] = useState<Invitation[] | null>(null);
  const [selected, setSelected] = useState<Invitation | null>(null);
  const [code, setCode] = useState("");
  const [validation, setValidation] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const load = useCallback(async () => {
    setInvitations(null);
    setSelected(null);
    const result = await api.run(invitationApi.inbox);
    if (result) {
      setInvitations(result.invitations);
      setUncertain(false);
    }
  }, [api.run]);
  useAccessRefresh(load);
  const back = () => {
    if (selected) {
      setSelected(null);
      setUncertain(false);
    } else onBack();
  };
  useAccessBack(back, api.busy);
  const preview = async (id: string) => {
    if (!invitation.shape.id.safeParse(id.trim()).success) {
      setValidation("Enter the complete invitation code.");
      return;
    }
    setValidation("");
    setSelected(null);
    const result = await api.run((token, signal) =>
      invitationApi.preview(id.trim(), token, signal),
    );
    if (result) {
      setSelected(result.invitation);
      setUncertain(false);
    }
  };
  const accept = async () => {
    if (!selected) return;
    setUncertain(true);
    const result = await api.run((token, signal) =>
      invitationApi.accept(selected.id, token, signal),
    );
    if (result) onOpenTrip(result.tripId);
  };
  return (
    <Screen contentKey={selected ? "preview" : "inbox"}>
      <Action
        title={selected ? "Back to invitations" : "Back to trips"}
        secondary
        disabled={api.busy}
        onPress={back}
      />
      <Heading>{selected ? "Review invitation" : "Your invitations"}</Heading>
      <Copy>
        Only the intended account can accept. A forwarded code does not grant
        access.
      </Copy>
      {api.error && <Notice error>{api.error.message}</Notice>}
      {selected ? (
        <>
          <AccessSection title={selected.trip.name}>
            <InvitationDetails invitation={selected} />
          </AccessSection>
          <Copy muted>
            Organizing a trip does not open another family’s private records.
            Existing access changes need an organizer or family coordinator.
          </Copy>
          {selected.status === "pending" && (
            <Action
              requiresConnection
              title={api.busy ? "Accepting…" : "Accept invitation"}
              busy={api.busy}
              disabled={
                !selected.tripApproved || !selected.familyApproved || uncertain
              }
              onPress={() => void accept()}
            />
          )}
          {selected.status === "accepted" && (
            <Action
              title="Open trip"
              onPress={() => onOpenTrip(selected.trip.id)}
            />
          )}
          {uncertain && (
            <Notice>
              Acceptance may already be saved. Refresh this invitation before
              taking another action.
            </Notice>
          )}
          <Action
            title="Refresh invitation"
            secondary
            busy={api.busy}
            onPress={() => void preview(selected.id)}
          />
        </>
      ) : (
        <>
          {!invitations && !api.error && (
            <Loading message="Checking your invitations…" />
          )}
          {invitations?.length === 0 && (
            <Notice>
              No invitations for this account. Ask an organizer or your family
              coordinator to invite your verified email or username.
            </Notice>
          )}
          {invitations?.map((i) => (
            <AccessSection key={i.id} title={i.trip.name}>
              <Copy>
                {i.family?.name ?? "Trip access"} · {i.status}
              </Copy>
              <Action
                title={`Review invitation for ${i.trip.name}`}
                secondary
                disabled={api.busy}
                onPress={() => void preview(i.id)}
              />
            </AccessSection>
          ))}
          <AccessSection title="Have an invitation code?">
            <Field
              label="Invitation code"
              value={code}
              onChangeText={setCode}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!api.busy}
              error={validation}
            />
            <Action
              title="Preview invitation code"
              disabled={api.busy}
              onPress={() => void preview(code)}
            />
          </AccessSection>
          <Action
            title="Refresh invitations"
            secondary
            busy={api.busy}
            onPress={() => void load()}
          />
        </>
      )}
    </Screen>
  );
}
