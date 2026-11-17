import { useState } from "react";
import { randomUUID } from "expo-crypto";
import {
  checklistEntryPatch,
  checklistTaskLabels,
  checklistTaskStatus,
  type ChecklistEntry,
} from "@nmt/contracts";
import { Screen, Copy } from "./ui";
import { PageHeader } from "./design-system";
import { ChecklistChoices } from "./checklist-ui";
import { checklistApi } from "./checklist-api";
import { useSave, SaveActions, type FormProps } from "./checklist-forms";
export function TaskProgressForm(props: FormProps & { entry: ChecklistEntry }) {
  const [requestId] = useState(randomUUID),
    [taskStatus, setStatus] = useState(props.entry.taskStatus ?? "to_do");
  const save = useSave(
    checklistEntryPatch,
    (input, token, signal) =>
      checklistApi.edit(props.scope, props.entry.id, input, token, signal),
    { ...props, subject: "task" },
  );
  return (
    <Screen>
      <PageHeader title="Update task" subtitle={props.entry.title} />
      <Copy>Choose the progress for this task. You can change it later.</Copy>
      <ChecklistChoices
        label="Progress"
        options={checklistTaskStatus.options.map((value) => ({
          value,
          label: checklistTaskLabels[value],
        }))}
        value={taskStatus}
        onChange={setStatus}
        locked={save.locked}
      />
      <SaveActions
        save={save}
        title="Save progress"
        onSave={() => void save.submit({ requestId, taskStatus })}
      />
    </Screen>
  );
}
