import { useState } from "react";
import { randomUUID } from "expo-crypto";
import {
  groupDeletionInput,
  responsibilityInput,
  type AccessMember,
} from "@nmt/contracts";
import { Copy, Field, Heading, Notice, Screen } from "./ui";
import { ChecklistChoices } from "./checklist-ui";
import { SaveActions, useSave } from "./checklist-forms";
import { invitationApi } from "./invitation-api";

export function ResponsibilityForm({
  path,
  family,
  members,
  actor,
  name,
  deleting,
  onBack,
  onSaved,
}: {
  path: string;
  family: boolean;
  members: AccessMember[];
  actor: string;
  name: string;
  deleting: boolean;
  onBack: () => void;
  onSaved: () => void;
}) {
  const [requestId] = useState(randomUUID);
  const [targetMemberId, setTarget] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const schema = deleting ? groupDeletionInput : responsibilityInput;
  const save = useSave<{
    requestId: string;
    targetMemberId?: string;
    confirmation?: "Delete family" | "Delete trip";
  }>(
    schema,
    (body, token, signal) =>
      invitationApi.change(
        {
          path: deleting ? path : `${path}/responsibility`,
          method: deleting ? "DELETE" : "POST",
          body,
        },
        token,
        signal,
      ),
    { onSaved, onCancel: onBack, subject: "members and permissions" },
  );
  const candidates = members.filter(
    (m) => m.id !== actor && m.role !== "viewer",
  );
  const phrase = family ? "Delete family" : "Delete trip";
  return (
    <Screen>
      <Heading>
        {deleting
          ? `Delete ${family ? "family" : "trip"}`
          : `Transfer ${family ? "family" : "trip"} responsibility`}
      </Heading>
      <Copy>{name}</Copy>
      {deleting ? (
        <>
          <Notice>
            Deletion removes this{" "}
            {family ? "family and its" : "trip, all its families and their"}{" "}
            records for every member, including both travel legs, bags, guides,
            attachments and history. Other trips remain. This cannot be undone
            here.
          </Notice>
          <Copy>
            {family
              ? "Only this family's effective coordinators may delete it. Trip memberships and other families stay."
              : "You must organize this trip and coordinate every family it contains. Organizing a trip does not authorize deleting another family's private content."}
          </Copy>
          <Copy>
            Managed copies are removed when connected clients refresh
            permissions. User-owned device exports and unreachable offline
            devices cannot be recalled. Previously issued file links retain
            their short expiry.
          </Copy>
          <Field
            label={`Type ${phrase}`}
            value={confirmation}
            onChangeText={setConfirmation}
            editable={!save.locked}
            error={save.fields.confirmation}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </>
      ) : (
        <>
          <Copy>
            The selected approved member becomes{" "}
            {family ? "family coordinator" : "trip organizer"}. Your role
            becomes {family ? "editor" : "member"}; you stay in the group until
            you explicitly leave. Other family and trip responsibilities stay
            separate.
          </Copy>
          <Copy>
            Only members who already have effective edit access in this scope
            are eligible. For a new family member, obtain that family's
            coordinator approval first.
          </Copy>
          {!candidates.length && (
            <Notice>
              No eligible approved member is available. Invite or grant access
              through the relevant approvals, then refresh this screen.
            </Notice>
          )}
          <ChecklistChoices
            label="Receive responsibility"
            options={candidates.map((m) => ({
              value: m.id,
              label: `${m.firstName} ${m.lastName} (@${m.username})`,
            }))}
            value={targetMemberId}
            onChange={setTarget}
            locked={save.locked}
          />
          {save.fields.targetMemberId && (
            <Notice error>{save.fields.targetMemberId}</Notice>
          )}
        </>
      )}
      <SaveActions
        save={save}
        title={deleting ? phrase : "Transfer responsibility"}
        onSave={() =>
          void save.submit(
            deleting
              ? { confirmation, requestId }
              : { targetMemberId, requestId },
          )
        }
      />
      <Copy muted>
        After a lost response, refresh members and permissions to check the
        result. A retry rechecks your current authority and never restores an
        old role or deleted group.
      </Copy>
    </Screen>
  );
}
