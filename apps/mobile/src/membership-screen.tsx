import { useCallback, useState } from "react";
import { Alert, Text } from "react-native";
import type {
  AccessMember,
  FamilyRole,
  Invitation,
  MemberProfile,
  TripDetail,
  TripRole,
} from "@nmt/contracts";
import { Action, Copy, Heading, Loading, Notice, Screen } from "./ui";
import { invitationApi, type AccessChange } from "./invitation-api";
import { tripApi } from "./trip-api";
import { useTripRequest } from "./use-trip-request";
import {
  AccessChoices,
  AccessSection,
  familyRoleChoices,
  InvitationDetails,
  tripRoleChoices,
  useAccessBack,
  useAccessRefresh,
} from "./invitation-ui";
import { InvitationForm } from "./invitation-form";
import { useTheme } from "./theme";

type AccessView = {
  detail: TripDetail;
  members: AccessMember[];
  tripMembers: AccessMember[];
  invitations: Invitation[];
};
export function MembershipScreen({
  tripId,
  familyId,
  profile,
  onBack,
}: {
  tripId: string;
  familyId?: string;
  profile: MemberProfile;
  onBack: () => void;
}) {
  const api = useTripRequest();
  const { colors } = useTheme();
  const [data, setData] = useState<AccessView | null>(null);
  const [mode, setMode] = useState<"list" | "compose">("list");
  const [editing, setEditing] = useState<AccessMember | null>(null);
  const [role, setRole] = useState<TripRole | FamilyRole>("viewer");
  const [roleChanged, setRoleChanged] = useState(false);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState("");
  const [created, setCreated] = useState<Invitation | null>(null);
  const load = useCallback(async () => {
    setData(null);
    setEditing(null);
    const result = await api.run(async (token, signal) => {
      const [detail, members, tripMembers, invitations] = await Promise.all([
        tripApi.read(tripId, token, signal),
        invitationApi.members(tripId, familyId, token, signal),
        invitationApi.members(tripId, undefined, token, signal),
        invitationApi.managed(tripId, token, signal),
      ]);
      return {
        detail,
        members: members.members,
        tripMembers: tripMembers.members,
        invitations: invitations.invitations.filter(
          (i) => !familyId || i.family?.id === familyId,
        ),
      };
    });
    if (result) {
      setData(result);
      setPending(false);
    }
  }, [api.run, tripId, familyId]);
  const refresh = useCallback(async () => {
    if (mode === "list") await load();
  }, [load, mode]);
  useAccessRefresh(refresh);
  const back = () => {
    if (editing && roleChanged)
      Alert.alert(
        "Leave access changes?",
        "Unsaved role changes will be cleared. Refresh members to check any uncertain save.",
        [
          { text: "Keep editing", style: "cancel" },
          { text: "Leave changes", onPress: () => setEditing(null) },
        ],
      );
    else if (editing) setEditing(null);
    else onBack();
  };
  useAccessBack(back, api.busy, mode === "list");
  const family = data?.detail.families.find((f) => f.id === familyId);
  const canManage = familyId
    ? !!family?.canCoordinate
    : data?.detail.trip.role === "organizer";
  const memberPath = `/trips/${tripId}${familyId ? `/families/${familyId}` : ""}/members`;
  const perform = async (change: AccessChange, invitation = false) => {
    setPending(true);
    setSaved("");
    const result = await api.run(async (token, signal) => {
      if (invitation)
        await invitationApi.invitationChange(change, token, signal);
      else await invitationApi.change(change, token, signal);
      return true;
    });
    if (result) {
      setSaved("Access saved.");
      await load();
    }
  };
  const remove = (member: AccessMember) =>
    Alert.alert(
      familyId ? "Remove family access?" : "Remove trip access?",
      familyId
        ? `@${member.username} will lose access to this family’s private records. Their trip membership stays.`
        : `@${member.username} will lose this trip and all its family access.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove access",
          style: "destructive",
          onPress: () =>
            void perform({
              path: `${memberPath}/${member.id}`,
              method: "DELETE",
            }),
        },
      ],
    );
  if (mode === "compose" && data)
    return (
      <InvitationForm
        detail={data.detail}
        initialFamilyId={familyId}
        onBack={() => setMode("list")}
        onSaved={(i) => {
          setCreated(i);
          setMode("list");
        }}
      />
    );
  return (
    <Screen contentKey={editing?.id ?? "members"}>
      <Action
        title={
          editing
            ? "Back to members"
            : familyId
              ? "Back to family"
              : "Back to trip"
        }
        secondary
        disabled={api.busy}
        onPress={back}
      />
      <Heading>
        {familyId ? "Family access" : "Trip members & invitations"}
      </Heading>
      {saved && <Notice>{saved}</Notice>}
      {created && data && (
        <AccessSection title="Invitation saved">
          <InvitationDetails invitation={created} />
          <Copy muted>
            The recipient can open Your invitations. To pass on a code, touch
            and hold it to copy. This code works only for the intended account.
          </Copy>
          <Text
            selectable
            style={{ color: colors.ink, fontSize: 16, lineHeight: 25 }}
          >
            {created.id}
          </Text>
          <Action
            title="Dismiss saved invitation"
            secondary
            onPress={() => setCreated(null)}
          />
        </AccessSection>
      )}
      {api.error && <Notice error>{api.error.message}</Notice>}
      {pending && api.error && (
        <Notice>
          Refresh to review the current access before changing it again. Nothing
          is queued.
        </Notice>
      )}
      {!data && !api.error && (
        <Loading message="Checking members and permissions…" />
      )}
      {data && (
        <>
          <Copy>{family?.name ?? data.detail.trip.name}</Copy>
          <Copy muted>
            Names and usernames are visible within this trip. Emails stay
            private.
          </Copy>
          <Notice>
            Assign another organizer or coordinator before removing the last
            responsible member. Trip viewers cannot edit family content.
          </Notice>
          {editing ? (
            <AccessSection title={`Access for @${editing.username}`}>
              <Copy>
                {editing.firstName} {editing.lastName}
              </Copy>
              <AccessChoices
                label={familyId ? "Family role" : "Trip role"}
                value={role}
                onChange={(value) => {
                  setRole(value);
                  setRoleChanged(true);
                }}
                disabled={pending || api.busy}
                choices={familyId ? familyRoleChoices : tripRoleChoices}
              />
              <Action
                title="Save member access"
                disabled={pending || !canManage}
                busy={api.busy}
                onPress={() =>
                  void perform({
                    path: `${memberPath}/${editing.id}`,
                    method: "PUT",
                    body: { role },
                  })
                }
              />
            </AccessSection>
          ) : (
            <>
              <AccessSection title="Members">
                {data.members.map((m) => (
                  <AccessSection
                    key={m.id}
                    title={`${m.firstName} ${m.lastName}`}
                  >
                    <Copy>
                      @{m.username} · {m.role}
                    </Copy>
                    {canManage && (
                      <Action
                        title={`Manage @${m.username}`}
                        secondary
                        disabled={pending || api.busy}
                        onPress={() => {
                          setEditing(m);
                          setRole(m.role);
                          setRoleChanged(false);
                        }}
                      />
                    )}
                    {(canManage || m.id === profile.id) && (
                      <Action
                        title={
                          m.id === profile.id
                            ? familyId
                              ? "Leave family"
                              : "Leave trip"
                            : `Remove @${m.username}`
                        }
                        secondary
                        disabled={pending || api.busy}
                        onPress={() => remove(m)}
                      />
                    )}
                  </AccessSection>
                ))}
              </AccessSection>
              {familyId && canManage && (
                <AccessSection title="Grant family access to a trip member">
                  <Copy>
                    Trip admission is already approved for these members. Choose
                    a family role before saving their access.
                  </Copy>
                  {data.tripMembers
                    .filter((m) => !data.members.some((f) => f.id === m.id))
                    .map((m) => (
                      <Action
                        key={m.id}
                        title={`Grant access to @${m.username}`}
                        secondary
                        disabled={pending || api.busy}
                        onPress={() => {
                          setEditing(m);
                          setRole("viewer");
                          setRoleChanged(false);
                        }}
                      />
                    ))}
                </AccessSection>
              )}
              {(canManage ||
                (familyId && data.detail.trip.role === "organizer")) && (
                <Action
                  title="Invite member"
                  disabled={pending || api.busy}
                  onPress={() => setMode("compose")}
                />
              )}
              <AccessSection title="Invitations">
                {data.invitations.length === 0 && (
                  <Copy>No invitations to manage in this view.</Copy>
                )}
                {data.invitations.map((i) => (
                  <AccessSection key={i.id} title={i.recipient}>
                    <InvitationDetails invitation={i} />
                    <Text
                      selectable
                      style={{
                        color: colors.muted,
                        fontSize: 16,
                        lineHeight: 25,
                      }}
                    >
                      Invitation code: {i.id}
                    </Text>
                    {i.status === "pending" && (
                      <>
                        {!i.tripApproved &&
                          data.detail.trip.role === "organizer" && (
                            <Action
                              title={`Approve trip admission for ${i.recipient}`}
                              disabled={pending || api.busy}
                              onPress={() =>
                                void perform(
                                  {
                                    path: `/trips/${tripId}/invitations/${i.id}/approve`,
                                    method: "POST",
                                    body: { scope: "trip" },
                                  },
                                  true,
                                )
                              }
                            />
                          )}
                        {!i.familyApproved &&
                          data.detail.families.some(
                            (f) => f.id === i.family?.id && f.canCoordinate,
                          ) && (
                            <Action
                              title={`Approve family access for ${i.recipient}`}
                              disabled={pending || api.busy}
                              onPress={() =>
                                void perform(
                                  {
                                    path: `/trips/${tripId}/invitations/${i.id}/approve`,
                                    method: "POST",
                                    body: { scope: "family" },
                                  },
                                  true,
                                )
                              }
                            />
                          )}
                        <Action
                          title={`Revoke invitation for ${i.recipient}`}
                          secondary
                          disabled={pending || api.busy}
                          onPress={() =>
                            Alert.alert(
                              "Revoke invitation?",
                              "The recipient will no longer be able to accept this offer.",
                              [
                                { text: "Cancel", style: "cancel" },
                                {
                                  text: "Revoke invitation",
                                  style: "destructive",
                                  onPress: () =>
                                    void perform(
                                      {
                                        path: `/trips/${tripId}/invitations/${i.id}/revoke`,
                                        method: "POST",
                                        body: {},
                                      },
                                      true,
                                    ),
                                },
                              ],
                            )
                          }
                        />
                      </>
                    )}
                  </AccessSection>
                ))}
              </AccessSection>
            </>
          )}
        </>
      )}
      <Action
        title="Refresh members and permissions"
        secondary
        busy={api.busy}
        onPress={() => void load()}
      />
      <Copy muted>Changes need a connection. Nothing is queued for later.</Copy>
    </Screen>
  );
}
